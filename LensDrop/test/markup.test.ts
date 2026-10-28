/**
 * Controlli statici sul markup:
 * - ogni selettore `must("#id")` usato dal codice deve esistere in index.html;
 * - nessun id duplicato;
 * - i riferimenti alle icone `<use href="#i-*">` devono avere un simbolo definito.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const html = readFileSync(resolve(root, "index.html"), "utf8");

function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) collectSources(path, out);
    else if (entry.endsWith(".ts")) out.push(path);
  }
  return out;
}

const sources = collectSources(resolve(root, "src"));

describe("markup e selettori", () => {
  it("dichiara ogni id richiesto dal codice", () => {
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
    const referenced = new Set<string>();

    for (const file of sources) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(/must(?:<[^>]*>)?\(\s*"#([A-Za-z0-9_-]+)"\s*\)/g)) {
        referenced.add(match[1]!);
      }
      for (const match of content.matchAll(/must\(`#([A-Za-z0-9_-]+)`/g)) {
        referenced.add(match[1]!);
      }
    }

    expect(referenced.size).toBeGreaterThan(30);
    const missing = [...referenced].filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
  });

  it("non contiene id duplicati", () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicates).toEqual([]);
  });

  it("definisce tutti i simboli delle icone utilizzate", () => {
    const symbols = new Set([...html.matchAll(/<symbol id="(i-[a-z]+)"/g)].map((match) => match[1]!));
    const used = new Set([...html.matchAll(/href="#(i-[a-z]+)"/g)].map((match) => match[1]!));
    expect(symbols.size).toBeGreaterThan(15);
    const missing = [...used].filter((name) => !symbols.has(name));
    expect(missing).toEqual([]);
  });

  it("include i collegamenti essenziali per PWA e sicurezza", () => {
    expect(html).toContain('rel="manifest"');
    expect(html).toContain("viewport-fit=cover");
    expect(html).toContain('lang="it"');
    expect(html).toContain("<noscript>");
    expect(html).toContain('type="module" src="/src/main.ts"');
  });
});
