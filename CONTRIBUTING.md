# Contributing

Thanks for looking. This is a small, single-maintainer project, and everything
below is meant to save you from writing something that then has to be rewritten.

## Where to say something

Open an issue: <https://github.com/smeet666/mcp-metacritic/issues>

That is the right place for a bug, a question, an idea, or "this answer looks
wrong to me". There is no mailing list, no chat and no support address. The npm
page is not a channel: nothing posted there reaches me.

## Pull requests are welcome, but talk to me first

Please open an issue before you write the code, even when you are sure of the
fix. Not to gate you: to agree on what the right answer actually is. Most of
the decisions in this repository are about what a model should be told, and two
reasonable people land on different answers. A short exchange up front is
cheaper for you than a rewrite after review.

The exception is the obviously mechanical: a typo, a dead link, a wrong version
in the documentation. Send those straight as a pull request.

If you have already written the code, open the pull request anyway and say so.
Nothing is wasted; we will just discuss the shape in the pull request instead.

## What a good report contains

The tool you called, the arguments you passed, and what came back. A single
copy-paste of the result is worth several paragraphs of description.

If the answer was wrong rather than missing, say what you expected and why:
a score reported as absent when the page publishes one is a real bug, and it is only visible to
someone who knows the subject.

If the server returned an error code, include it. `not_found`, `rate_limited`,
`parse_failure` and `network_error` mean quite different things, and the first
question is always which one you saw.

## What this server will and will not do

It reads Metacritic and returns what it reads. It does not write anything back, it
holds no account, and it needs no API key.

Three rules shape most of the code, and a change that breaks one of them will
be turned down however useful it looks:

- **A failure is never reported as an empty result.** If a request could not be
  made, the answer says so. Silence about a failure becomes "there is none"
  in the mouth of a model, which is a false statement about the world.
- **Every result carries its source.** Content that came from Metacritic goes out
  with a link to the page it came from, and the text block keeps that link even
  when it has to be shortened.
- **The server paces itself.** Metacritic is someone else's site. The minimum
  interval between requests has a floor that configuration cannot go below.

## Running it locally

```bash
npm install
npm run typecheck
npm test            # unit tests, everything upstream is a fixture
npm run build
npm run inspector   # drive the tools by hand in the MCP Inspector
```

The unit tests never touch the network. There is also a live suite,
`MC_LIVE=1 npm run test:live`, which does: it makes one request per route
against https://www.metacritic.com and checks the fields the parsers depend on. Run it if you
changed anything in the parsing layer, and expect it to be slow.

`npm run format` before you commit.

## The shape of the code

The API layer under `src/` never imports the MCP SDK, and the MCP layer never
performs HTTP. That separation is why the client is published as its own
subpath export and usable as a plain library, so please keep it.

The tools are `search_titles`, `get_title`, `get_reviews` and `browse_titles`. A new tool is a bigger conversation than a new field on
an existing one, which is another reason to open an issue first.

## Writing style in the code

Comments explain why, not what, and they read as if the code had always looked
this way: no "now uses", no "this is better than before". Someone reading the
file for the first time should not have to know what it replaced.

## When Metacritic changes

The upstream is not a documented API. When it changes shape, the unit tests
stay green because they run on fixtures, and the nightly live canary is what
catches it. If you see a `parse_failure` in normal use, that is very likely
what happened, and it is worth an issue with the arguments that triggered it.
