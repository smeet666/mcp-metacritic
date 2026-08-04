# Security

## Reporting a vulnerability

Use GitHub's private reporting: **Security → Report a vulnerability** on
<https://github.com/smeet666/mcp-metacritic/security/advisories/new>. It reaches me
without the report being public first.

Please do not open a public issue for something exploitable.

I will acknowledge within a few days. This is a single-maintainer project, so
treat that as a best effort rather than a service commitment.

## What is in scope

This server is a read-only client for Metacritic. It holds no credentials, needs no
API key, opens no port, and writes nothing back to Metacritic. That rules out most
of what a vulnerability report usually concerns.

What remains is worth reporting:

- **Anything that lets a caller reach a host other than Metacritic.** The URLs are
  built from a fixed base; an argument that escapes it is a real finding.
- **Anything upstream text can do to the caller.** Titles, quotes and lyrics
  come from a third party and end up in front of a model. A path by which that
  text could be read as instructions rather than as content is in scope, and so
  is anything that could make it look like the server's own words.
- **Anything that turns a failure into a confident answer.** A crafted response
  that makes the server report "there is none" when it means "I could not ask"
  is a correctness bug with real consequences, and I treat it as security.
- **Dependency vulnerabilities** that are actually reachable from this code.

## What is not

Rate limiting by Metacritic, or Metacritic being down, is the upstream's business and
the server already reports it as such. A report that consists only of an
automated scanner's output, with no path from it to this code, will be closed.

## Versions

Only the latest published version is supported. Fixes go out as a new release
on npm rather than as a patch to an older line.
