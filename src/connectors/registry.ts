import type { Connector, ProviderId } from "./types.js";
import { clickupConnector } from "./clickup.js";
import { gohighlevelConnector } from "./gohighlevel.js";
import { searchConsoleConnector } from "./google/search-console.js";
import { stubConnectors } from "./stubs.js";

const all: Connector[] = [
  clickupConnector,
  gohighlevelConnector,
  searchConsoleConnector,
  ...stubConnectors,
];

const byId = new Map<string, Connector>(all.map((c) => [c.id, c]));

export function getConnector(id: string): Connector | undefined {
  return byId.get(id);
}

export function listConnectors(): Connector[] {
  return all;
}

export function isProviderId(id: string): id is ProviderId {
  return byId.has(id);
}
