import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import {
  type EmptyResponse,
  HttpResponse,
  type JsonResponse,
  type RedirectResponse,
  type StreamResponse,
  type TextResponse,
} from './responses.ts';

const bytesOf = (text: string) => new TextEncoder().encode(text);

async function* chunks() {
  yield bytesOf('a');
}

describe('HttpResponse factories', () => {
  it('json: frozen, branded, default media type, body kept by reference', () => {
    const body = { id: 'x' };
    const response = HttpResponse.json(201, body);

    assert.strictEqual(response.kind, 'json');
    assert.strictEqual(response.status, 201);
    assert.strictEqual(response.contentType, 'application/json');
    assert.strictEqual(response.body, body);
    assert.deepStrictEqual(response.headers, []);
    assert.ok(Object.isFrozen(response));
    assert.ok(HttpResponse.is(response));
  });

  it('json: custom media type and a null body', () => {
    const response = HttpResponse.json(
      400,
      { title: 'Bad' },
      { contentType: 'application/problem+json' },
    );
    assert.strictEqual(response.contentType, 'application/problem+json');
    assert.strictEqual(HttpResponse.json(200, null).body, null);
  });

  it('json: an undefined body is rejected', () => {
    assert.throws(() => HttpResponse.json(200, undefined), {
      name: 'TypeError',
      message: /use HttpResponse\.empty\(status\)/,
    });
  });

  it('text, bytes: default media types and body checks', () => {
    assert.strictEqual(HttpResponse.text(200, 'hi').contentType, 'text/plain');
    assert.strictEqual(
      HttpResponse.text(200, '<p>', { contentType: 'text/html' }).contentType,
      'text/html',
    );
    assert.strictEqual(
      HttpResponse.bytes(200, Buffer.from('x')).contentType,
      'application/octet-stream',
    );
    assert.throws(
      () => HttpResponse.text(200, 42 as unknown as string),
      TypeError,
    );
    assert.throws(
      () => HttpResponse.bytes(200, 'x' as unknown as Uint8Array),
      TypeError,
    );
  });

  it('stream: accepts a ReadableStream, an async generator and a Node Readable', () => {
    const sources = [
      new ReadableStream<Uint8Array>(),
      chunks(),
      Readable.from([bytesOf('a')]),
    ];
    for (const source of sources) {
      const response = HttpResponse.stream(200, source);
      assert.strictEqual(response.kind, 'stream');
      assert.strictEqual(response.body, source);
    }
    assert.throws(
      () =>
        HttpResponse.stream(
          200,
          bytesOf('a') as unknown as AsyncIterable<Uint8Array>,
        ),
      { name: 'TypeError', message: /ReadableStream or an async iterable/ },
    );
  });

  it('redirect: owns the location', () => {
    const response = HttpResponse.redirect(303, new URL('https://x.test/a'));
    assert.strictEqual(response.kind, 'redirect');
    assert.strictEqual(response.location, 'https://x.test/a');
    assert.throws(
      () => HttpResponse.redirect(302, '/a', { headers: { Location: '/b' } }),
      { name: 'TypeError', message: /second argument/ },
    );
    assert.throws(() => HttpResponse.redirect(302, ''), TypeError);
  });

  it('empty: no-body statuses and ordinary ones', () => {
    for (const status of [204, 205, 304, 200, 202]) {
      assert.strictEqual(HttpResponse.empty(status).status, status);
    }
  });

  it('native: wraps a Web Response and takes its status', () => {
    const web = new Response('x', { status: 418 });
    const response = HttpResponse.native(web);
    assert.strictEqual(response.kind, 'native');
    assert.strictEqual(response.status, 418);
    assert.strictEqual(response.response, web);
  });

  it('native: rejects a network error, a used body and a non-Response', async () => {
    assert.throws(() => HttpResponse.native(Response.error()), TypeError);
    const used = new Response('x');
    await used.text();
    assert.throws(() => HttpResponse.native(used), {
      name: 'TypeError',
      message: /already read/,
    });
    assert.throws(
      () => HttpResponse.native({ status: 200 } as unknown as Response),
      TypeError,
    );
  });
});

describe('HttpResponse status rules', () => {
  const bodyFactories = {
    json: (status: number) => HttpResponse.json(status, {}),
    text: (status: number) => HttpResponse.text(status, ''),
    bytes: (status: number) => HttpResponse.bytes(status, bytesOf('')),
    stream: (status: number) => HttpResponse.stream(status, chunks()),
  };

  for (const [name, make] of Object.entries(bodyFactories)) {
    it(`${name}: 204, 205 and 304 point at empty`, () => {
      for (const status of [204, 205, 304]) {
        assert.throws(() => make(status), {
          name: 'RangeError',
          message: new RegExp(`use HttpResponse\\.empty\\(${status}\\)`),
        });
      }
    });

    it(`${name}: 206, informational and out-of-range statuses throw`, () => {
      for (const status of [206, 100, 103, 199, 600, 200.5, Number.NaN]) {
        assert.throws(() => make(status), RangeError);
      }
    });
  }

  it('empty: 206 and informational statuses throw', () => {
    for (const status of [206, 101, 600]) {
      assert.throws(() => HttpResponse.empty(status), RangeError);
    }
  });

  it('redirect: only 301, 302, 303, 307 and 308', () => {
    for (const status of [300, 304, 200]) {
      assert.throws(
        () => HttpResponse.redirect(status as 302, '/a'),
        RangeError,
      );
    }
  });
});

describe('HttpResponse headers', () => {
  it('normalizes names, combines repeats and keeps each set-cookie', () => {
    const response = HttpResponse.json(
      200,
      {},
      {
        headers: [
          ['X-Trace', 'a'],
          ['x-trace', 'b'],
          ['Set-Cookie', 'a=1'],
          ['set-cookie', 'b=2'],
        ],
      },
    );
    // Iteration order differs between runtimes (Bun does not sort).
    assert.deepStrictEqual(
      [...response.headers].sort(([a], [b]) => a.localeCompare(b)),
      [
        ['set-cookie', 'a=1'],
        ['set-cookie', 'b=2'],
        ['x-trace', 'a, b'],
      ],
    );
    assert.ok(Object.isFrozen(response.headers));
    assert.ok(Object.isFrozen(response.headers[0]));
  });

  it('accepts a record, a Headers object and another response headers', () => {
    const first = HttpResponse.json(
      200,
      {},
      { headers: { 'Cache-Control': 'no-store' } },
    );
    const fromHeaders = HttpResponse.empty(204, {
      headers: new Headers({ 'Cache-Control': 'no-store' }),
    });
    const copied = HttpResponse.text(200, 'x', { headers: first.headers });
    assert.deepStrictEqual(fromHeaders.headers, first.headers);
    assert.deepStrictEqual(copied.headers, first.headers);
  });

  it('rejects a content-type header on a body response', () => {
    assert.throws(
      () =>
        HttpResponse.json(
          200,
          {},
          { headers: { 'Content-Type': 'text/html' } },
        ),
      { name: 'TypeError', message: /options\.contentType/ },
    );
  });

  it('rejects an invalid header value', () => {
    assert.throws(
      () => HttpResponse.empty(204, { headers: { 'x-bad': 'a\nb' } }),
      TypeError,
    );
  });
});

describe('HttpResponse.is', () => {
  it('recognizes every factory result', () => {
    const responses = [
      HttpResponse.json(200, {}),
      HttpResponse.text(200, ''),
      HttpResponse.bytes(200, bytesOf('')),
      HttpResponse.stream(200, chunks()),
      HttpResponse.redirect(302, '/'),
      HttpResponse.empty(204),
      HttpResponse.native(new Response(null)),
    ];
    for (const response of responses) {
      assert.ok(HttpResponse.is(response), response.kind);
    }
  });

  it('rejects look-alikes and non-objects', () => {
    for (const value of [
      null,
      undefined,
      'json',
      200,
      { kind: 'json', status: 200, headers: [], body: {} },
      new Response('x'),
    ]) {
      assert.strictEqual(HttpResponse.is(value), false);
    }
  });
});

describe('HttpResponse types', () => {
  it('are checked by npm run check:types:tests', () => {
    assert.strictEqual(typeof typeContract, 'function');
  });
});

// Compile-time contract, checked by `npm run check:types:tests`; never run.
function typeContract(source: ReadableStream<Uint8Array>) {
  const created: JsonResponse<201, { id: string }> = HttpResponse.json(201, {
    id: 'x',
  });
  const problem: JsonResponse<
    400,
    { title: string },
    'application/problem+json'
  > = HttpResponse.json(
    400,
    { title: 'Bad' },
    { contentType: 'application/problem+json' },
  );
  const html: TextResponse<200, 'text/html'> = HttpResponse.text(200, '<p>', {
    contentType: 'text/html',
  });
  const streamed: StreamResponse<200> = HttpResponse.stream(200, source);
  const moved: RedirectResponse<308> = HttpResponse.redirect(308, '/new');
  const nothing: EmptyResponse<204> = HttpResponse.empty(204);
  const any: HttpResponse[] = [
    created,
    problem,
    html,
    streamed,
    moved,
    nothing,
  ];

  // A status only known at runtime compiles; the factory checks it.
  const status: number = any.length;
  HttpResponse.json(status, {});
  HttpResponse.empty(status);

  // @ts-expect-error the literal status is kept
  const wrongStatus: JsonResponse<200, { id: string }> = HttpResponse.json(
    201,
    {
      id: 'x',
    },
  );
  // @ts-expect-error 204 never carries a body
  HttpResponse.json(204, {});
  // @ts-expect-error 304 never carries a body
  HttpResponse.text(304, '');
  // @ts-expect-error 205 never carries a body
  HttpResponse.bytes(205, new Uint8Array());
  // @ts-expect-error 206 is reserved for file responses
  HttpResponse.stream(206, source);
  // @ts-expect-error informational statuses are not final responses
  HttpResponse.json(101, {});
  // @ts-expect-error informational statuses are not final responses
  HttpResponse.empty(103);
  // @ts-expect-error 206 is reserved for file responses
  HttpResponse.empty(206);
  // @ts-expect-error not a redirect status
  HttpResponse.redirect(200, '/');
  // @ts-expect-error a redirect status must be literal
  HttpResponse.redirect(status, '/');
  // @ts-expect-error text bodies are strings
  HttpResponse.text(200, { id: 'x' });
  return wrongStatus;
}
