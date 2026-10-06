import fs from 'fs';
import path from 'path';
import { EventFragment, Interface, ParamType } from '@ethersproject/abi';
import { keccak256 } from '@ethersproject/keccak256';
import { toUtf8Bytes } from '@ethersproject/strings';
import { TopicLogDecoder, getTopicLogDecoder } from './topic-log-decoder';

// A log the decoder is exercised with: only topics/data are read.
type TestLog = { topics: string[]; data: string };

const collectAbiFiles = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) collectAbiFiles(entryPath, out);
    else if (entry.name.endsWith('.json')) out.push(entryPath);
  }
  return out;
};

const loadInterfaces = (): { name: string; iface: Interface }[] => {
  const abiDir = path.join(__dirname, '../abi');
  const interfaces: { name: string; iface: Interface }[] = [];
  for (const file of collectAbiFiles(abiDir)) {
    let iface: Interface;
    try {
      const abi = require(file);
      iface = new Interface(abi.abi ?? abi);
    } catch (e) {
      // ABIs ethers itself refuses (duplicate fragments, ...) are irrelevant here
      continue;
    }
    if (Object.keys(iface.events).length === 0) continue;
    interfaces.push({ name: path.relative(abiDir, file), iface });
  }
  return interfaces;
};

const loadCachedLogs = (): TestLog[] => {
  const logsPath = path.join(__dirname, '../../tests/logs.json');
  if (!fs.existsSync(logsPath)) return [];
  const blocks: Record<string, { logs: TestLog[] }> = require(logsPath);
  return Object.values(blocks).flatMap(block => block.logs ?? []);
};

// Deterministic value for a param, so encodeEventLog can build a log for every
// event of every ABI.
const sampleValue = (param: ParamType, seed: number): any => {
  if (param.baseType === 'array') {
    const length = param.arrayLength === -1 ? 2 : param.arrayLength;
    return Array.from({ length }, (_, i) =>
      sampleValue(param.arrayChildren, seed + i),
    );
  }
  if (param.baseType === 'tuple') {
    return param.components.map((c, i) => sampleValue(c, seed + i));
  }
  if (param.baseType === 'address') {
    return '0x' + (seed + 1).toString(16).padStart(40, '0');
  }
  if (param.baseType === 'bool') return seed % 2 === 0;
  if (param.baseType === 'string') return `sample-${seed}`;
  if (param.baseType === 'bytes') return '0x' + 'ab'.repeat(seed % 5 || 1);
  if (param.baseType.startsWith('bytes')) {
    const size = Number(param.baseType.slice('bytes'.length));
    return '0x' + (seed + 1).toString(16).padStart(size * 2, '0');
  }
  if (param.baseType.startsWith('uint')) return String(seed + 1);
  if (param.baseType.startsWith('int')) return String(-(seed + 1));
  throw new Error(`unsupported param type ${param.baseType}`);
};

const encodeSampleLog = (
  iface: Interface,
  fragment: EventFragment,
): TestLog | null => {
  try {
    const values = fragment.inputs.map((input, i) => sampleValue(input, i));
    return iface.encodeEventLog(fragment, values);
  } catch (e) {
    return null;
  }
};

// `parseLog` returns a deep copy of the fragment rather than the fragment
// itself, so `eventFragment` is compared through its formatted signature.
const comparable = (parsed: any) => ({
  name: parsed.name,
  signature: parsed.signature,
  topic: parsed.topic,
  args: parsed.args,
  fragment: parsed.eventFragment.format(),
  argKeys: Object.keys(parsed.args),
  argsFrozen: Object.isFrozen(parsed.args),
});

const expectSameDecoding = (
  iface: Interface,
  decoder: TopicLogDecoder,
  log: TestLog,
) => {
  let expected: any;
  let expectedError: Error | undefined;
  try {
    expected = iface.parseLog(log);
  } catch (e) {
    expectedError = e as Error;
  }

  let actual: any;
  let actualError: Error | undefined;
  try {
    actual = decoder.decode(log);
  } catch (e) {
    actualError = e as Error;
  }

  if (expectedError || actualError) {
    expect(actualError?.message).toEqual(expectedError?.message);
    return false;
  }

  expect(comparable(actual)).toEqual(comparable(expected));
  return true;
};

describe('TopicLogDecoder', () => {
  const interfaces = loadInterfaces();

  it('loads the repository ABIs', () => {
    expect(interfaces.length).toBeGreaterThan(100);
  });

  it('decodes every event of every ABI exactly like parseLog', () => {
    let decoded = 0;
    for (const { iface } of interfaces) {
      const decoder = new TopicLogDecoder(iface);
      for (const name of Object.keys(iface.events)) {
        const fragment = iface.events[name];
        if (fragment.anonymous) continue;
        const log = encodeSampleLog(iface, fragment);
        if (!log) continue;
        if (expectSameDecoding(iface, decoder, log)) decoded++;
      }
    }
    expect(decoded).toBeGreaterThan(500);
  });

  it('matches parseLog on real logs, decoded and rejected alike', () => {
    const logs = loadCachedLogs();
    expect(logs.length).toBeGreaterThan(0);

    // ABIs that recognise at least one of the cached logs; the others would
    // only repeat the unknown topic path already covered below.
    const topics = new Set(logs.map(log => log.topics[0]));
    const relevant = interfaces.filter(({ iface }) =>
      Object.keys(iface.events).some(name =>
        topics.has(iface.getEventTopic(iface.events[name])),
      ),
    );
    expect(relevant.length).toBeGreaterThan(0);

    let decoded = 0;
    for (const { iface } of relevant) {
      const decoder = new TopicLogDecoder(iface);
      for (const log of logs) {
        if (expectSameDecoding(iface, decoder, log)) decoded++;
      }
    }
    expect(decoded).toBeGreaterThan(0);
  });

  it('throws the `no matching event` error of parseLog on an unknown topic', () => {
    const iface = new Interface([
      'event Transfer(address indexed from, address indexed to, uint256 value)',
    ]);
    const decoder = new TopicLogDecoder(iface);
    const log = {
      topics: [keccak256(toUtf8Bytes('Unknown(uint256)'))],
      data: '0x',
    };

    expect(() => decoder.decode(log)).toThrow('no matching event');
  });

  it('resolves a topic regardless of its case', () => {
    const iface = new Interface([
      'event Transfer(address indexed from, address indexed to, uint256 value)',
    ]);
    const decoder = new TopicLogDecoder(iface);
    const log = encodeSampleLog(
      iface,
      iface.events['Transfer(address,address,uint256)'],
    )!;

    const upperCased = {
      ...log,
      topics: [
        log.topics[0].toUpperCase().replace('0X', '0x'),
        ...log.topics.slice(1),
      ],
    };

    expect(decoder.decode(upperCased).name).toEqual('Transfer');
  });

  it('leaves an anonymous event to parseLog', () => {
    const iface = new Interface(['event Anon(uint256 value) anonymous']);
    const decoder = new TopicLogDecoder(iface);
    const log = iface.encodeEventLog(iface.events['Anon(uint256)'], ['1']);

    // an anonymous event emits no topic0, so neither can resolve it
    expectSameDecoding(iface, decoder, log);
  });

  it('shares one decoder per interface', () => {
    const iface = new Interface(['event Ping()']);
    expect(getTopicLogDecoder(iface)).toBe(getTopicLogDecoder(iface));
  });
});
