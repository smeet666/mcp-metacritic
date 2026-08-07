# Changelog

## 1.2.0

- Refuse an argument no tool declares, instead of reading it and dropping it.
  Every tool's published schema already marked `additionalProperties: false`,
  but the server accepted an argument outside that schema and silently
  ignored it, so a caller who mistyped a name got a confident answer computed
  on the defaults rather than on what they asked for. Every tool now refuses
  such a call under the `invalid_input` code, names the argument, and offers
  the declared name when one is close: `search_titles` called with `limt`
  points to `limit`, and `get_title` called with `chars` points to
  `max_chars`.

## 1.1.2

- Stop reporting an entry Metacritic has not scored as an entry scored zero.
  The listing routes write 0 where the detail route writes null, so a search for
  Angel's Egg came back with "0/100" for a film that holds three positive
  reviews and no Metascore. A score of 0 is now read as the absence it stands
  for, in search rows, in browse rows and in the score breakdown, and the same
  applies to a runtime of 0 minutes on an entry that has not opened.

## 1.1.1

- Stop published text from producing a line shaped like one this server writes.
  The text block ends with lines opening "Note:" and "Source:", and anyone who
  publishes on the site can put those same words at the start of a line in a
  title or a description, where a reader has no way to tell the two apart. Such
  a line is indented in the text block. The structured output carries the text
  exactly as published, as it did.

## 1.1.0

- Ship a `.mcpb` bundle on every release, so the server can be installed by
  opening a file rather than by having npm and a client configuration. The
  dependencies are compiled into a single file, which makes the bundle 164 kB
  and five files instead of 3 MB and two thousand: a bundle is unpacked, not
  resolved, so a copy of `node_modules` would only be dead weight. The npm build
  still keeps its dependencies external, and the two builds are separate
  configurations for that reason.
- Declare the bundle in `server.json`, with the hash the registry requires
  computed from the released file at publish time rather than committed as a
  value that goes stale on every build.

## 1.0.3

Housekeeping, with no change to what any tool returns.

- Declare the tool schemas as objects rather than as the raw shape the SDK now
  deprecates. The emitted `tools/list` is byte for byte what it was.
- Add an icon and a `websiteUrl` to `server.json`, so the registry has something
  to show next to the entry.

## 1.0.2

- Carry the notes into the text block of every tool. They are what qualifies an
  answer: that a list was capped, that a score could not be read and is missing
  rather than absent, that streaming offers do not apply to a game, that a
  description continues at a further offset. A client rendering only the text
  read the unqualified answer, so `get_title` on a game showed "Where to watch:
  nothing listed" with nothing to say the section does not apply, and a cut
  description ended with no sign there was more. The notes sit alongside the
  attribution so they survive truncation, and a long run of them is trimmed from
  the tail rather than crowding out the answer.
- Render `production` in the text block. The section was returned in the
  structured output and nowhere in the text.

## 1.0.1

- Build the text block from the same sections as the structured output. It
  printed the genres even when 'basic' had not been requested, contradicting a
  payload that correctly returned none, and it never printed the streaming
  offers at all: a client rendering only text paid an extra request for
  'where_to_watch' and saw nothing come back. Awards and networks are rendered
  too, and the runtime alongside the genres.

## 1.0.0

First stable release. The tool contracts are settled: tool names, argument names
and the shape of the structured output will not change without a major version.

Four tools over Metacritic, with no API key and no account:

- `search_titles` finds films, shows and games by title and returns compact rows
  carrying the critic Metascore, so a question about the critical verdict is
  answered in one call.
- `get_title` reads one entry section by section. A detail response is 46 KB for
  a film, so `basic` and `scores` are the default and everything else costs a
  request only when asked for.
- `get_reviews` returns individual critic or audience reviews, filtered by
  verdict, each with the publication that ran it and a link to the article.
- `browse_titles` lists by score, release date or current popularity, which is
  what answers "the best horror films" when there is no title to look up.

Two things this release is careful about.

The critic score runs to 100 and the audience score to 10. Every score is
returned with its own `max`, and the tool descriptions say so, because
averaging the two is the easiest mistake to make with this data.

A failure is never reported as an empty result. Metacritic answers with either
a `data` object or an `errors` array, and this server reads that distinction: a
missing entry produces an error with a code, and a request that could not be
made says so rather than claiming Metacritic publishes nothing.
