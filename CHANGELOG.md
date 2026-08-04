# Changelog\n\n## 1.0.1

- Build the text block from the same sections as the structured output. It
  printed the genres even when 'basic' had not been requested, contradicting a
  payload that correctly returned none, and it never printed the streaming
  offers at all: a client rendering only text paid an extra request for
  'where_to_watch' and saw nothing come back. Awards and networks are rendered
  too, and the runtime alongside the genres.
  \n 1.0.0

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
