import { http, HttpResponse } from "msw";
import { ADDR, wireCandle, wireDetail, wireHolder, wireToken, wireTrade } from "./fixtures";

export const API = "http://api.test";

/** Sensible defaults for every endpoint. A test that cares about a response overrides it with server.use(...). */
export const handlers = [
  http.get(`${API}/:chain/tokens`, () => HttpResponse.json({ items: [wireToken()] })),
  http.get(`${API}/:chain/tokens/:address`, () => HttpResponse.json(wireDetail())),
  http.get(`${API}/:chain/tokens/:address/trades`, () => HttpResponse.json({ items: [wireTrade()] })),
  http.get(`${API}/:chain/tokens/:address/holders`, () => HttpResponse.json({ items: [wireHolder()] })),
  http.get(`${API}/:chain/tokens/:address/candles`, () => HttpResponse.json({ items: [wireCandle()] })),
];

export { ADDR };
