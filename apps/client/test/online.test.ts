import { describe, expect, it } from 'vitest';
import { normaliseServer } from '../src/online';

describe('server address (M20)', () => {
  it('turns what people type into a WebSocket address', () => {
    expect(normaliseServer('gumfire.example.com', true)).toBe('wss://gumfire.example.com/ws');
    expect(normaliseServer('https://gumfire.example.com/', true)).toBe('wss://gumfire.example.com/ws');
    expect(normaliseServer('http://192.168.1.20:8787', false)).toBe('ws://192.168.1.20:8787/ws');
    expect(normaliseServer('wss://relay.example.com/ws', true)).toBe('wss://relay.example.com/ws');
    expect(normaliseServer('192.168.1.20:8787', false)).toBe('ws://192.168.1.20:8787/ws');
    expect(normaliseServer('nas:8787', false)).toBe('ws://nas:8787/ws');
    // an https page may not open plain ws://
    expect(normaliseServer('192.168.1.20:8787', true)).toBe('wss://192.168.1.20:8787/ws');
    expect(normaliseServer('relay.example.com:8443', false)).toBe('wss://relay.example.com:8443/ws');
  });
});
