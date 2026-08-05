# mcp-metacritic

## Tagline
Metascores, audience scores and critic reviews for films, shows and games.

## Description
An MCP server for Metacritic. Search films, shows and games, read what critics
scored them and what they wrote, and browse rankings when there is no title to
look up.

The two scores are kept apart on purpose. A Metascore runs to 100 and an
audience score to 10, so every score is returned with its own scale, and
nothing invites averaging them. An entry Metacritic has not scored says so
rather than reporting a zero, which on a scale starting at zero would be a
verdict.

Critic reviews come back with the publication and a link to the original
article, so a quote can be attributed to the person who wrote it.

## Setup Requirements
- `MC_USER_AGENT` (optional): Identify your own client. The project's own identifier is appended.
- `MC_MIN_INTERVAL_MS` (optional): Minimum gap between requests. Default 1000, and values below 500 are refused.
- `MC_TIMEOUT_MS` (optional): Per-request deadline. Default 15000.
- `MC_CACHE_TTL_MS` (optional): In-memory cache lifetime for entries. Default 86400000, with scores cached one hour. Set 0 to turn it off.
- `MC_LOG_LEVEL` (optional): silent, error, info or debug. Default error, on stderr.

No API key and no account are needed.

## Category
Content & Media

## Features
- Search films, shows and games in one call, or restrict to one catalogue
- The critic Metascore comes back with the search, so a verdict costs one request
- Read one entry section by section: description, scores, awards, production, networks, where to watch
- Critic and audience score breakdowns, each with its own scale and review counts
- Individual reviews, filtered by positive, neutral or negative
- Critic reviews carry the publication and a link to the original article
- Browse rankings by score, by release date or by current popularity, filtered by genre
- An unscored entry reports no score rather than a zero
- Attribution and a source link on every result

## Getting Started
- "How was Dune Part Two received by critics?"
- "What did reviewers dislike about Cyberpunk 2077 at launch?"
- "What are the best rated horror films of all time?"
- Tool: search_titles — Finds an entry and its slug and kind, with the critic Metascore
- Tool: get_title — Reads one entry, only the sections you ask for
- Tool: get_reviews — Reads individual critic or user reviews
- Tool: browse_titles — Lists rankings by score, recency or popularity

## Tags
movies, tv, games, reviews, ratings, metascore, metacritic, criticism, no-api-key

## Documentation URL
https://github.com/smeet666/mcp-metacritic#readme
