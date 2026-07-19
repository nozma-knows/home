import { expect, it } from "bun:test";

import { parseFeed } from "./rss";

it("normalizes RSS items", () => {
  const result = parseFeed(
    `<?xml version="1.0"?><rss><channel><title>Example</title><item><guid>1</guid><title>Launch</title><link>https://example.com/launch</link><description><![CDATA[<p>We launched.</p>]]></description><pubDate>Sun, 19 Jul 2026 12:00:00 GMT</pubDate></item></channel></rss>`,
  );
  expect(result.title).toBe("Example");
  expect(result.entries[0]?.title).toBe("Launch");
  expect(result.entries[0]?.preview).toBe("We launched.");
});
