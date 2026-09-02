# mcp-metacritic

[![npm](https://img.shields.io/npm/v/mcp-metacritic.svg)](https://www.npmjs.com/package/mcp-metacritic)
[![CI](https://github.com/smeet666/mcp-metacritic/actions/workflows/ci.yml/badge.svg)](https://github.com/smeet666/mcp-metacritic/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/mcp-metacritic.svg)](./LICENSE)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-6E56CF)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.smeet666/mcp-metacritic)
[![Glama](https://glama.ai/mcp/servers/smeet666/mcp-metacritic/badges/score.svg)](https://glama.ai/mcp/servers/smeet666/mcp-metacritic)
[![M8ven](https://m8ven.ai/badge/mcp/smeet666-mcp-metacritic-1yvblv?variant=verified)](https://m8ven.ai/mcp/smeet666-mcp-metacritic-1yvblv)
[![LobeHub](https://lobehub.com/badge/mcp/smeet666-mcp-metacritic)](https://lobehub.com/mcp/smeet666-mcp-metacritic)
[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=metacritic&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm1jcC1tZXRhY3JpdGljIl19)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=metacritic&config=%7B%22name%22%3A%22metacritic%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22mcp-metacritic%22%5D%7D)

<!-- m8ven-verify: 01151bc5a8514e55175f063339bedc6f -->

[Metacritic](https://www.metacritic.com) gathers what critics and audiences said
about films, television series and video games. Each entry carries the year, the
age rating, the genres, and two scores of its own: the Metascore, a weighted
average of the professional reviews, and the user score, out of ten, from the
people who signed up to rate it. Under each entry sit the reviews themselves,
with the publication that ran them and the quoted line.

This server connects a chat client to that catalogue. You can search for a title,
read its entry with its scores and its details, browse a catalogue by score,
recency or popularity, and read the reviews of one title, filtered by critic or
audience and by how favourable they were. It needs no API key and no account.

_[Version française](#mcp-metacritic-français)_

---

## Install

**One-click install**

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=metacritic&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm1jcC1tZXRhY3JpdGljIl19)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=metacritic&config=%7B%22name%22%3A%22metacritic%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22mcp-metacritic%22%5D%7D)

**Claude Code**

```bash
claude mcp add metacritic -- npx -y mcp-metacritic
```

**Claude Desktop, Cursor, and any client using the standard config format**

```json
{
  "mcpServers": {
    "metacritic": {
      "command": "npx",
      "args": ["-y", "mcp-metacritic"]
    }
  }
}
```

Node 24 or later is required, and no environment variable has to be set.

### With Docker

```json
{
  "mcpServers": {
    "metacritic": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "ghcr.io/smeet666/mcp-metacritic:2.0.1"]
    }
  }
}
```

`-i` keeps stdin open, which is where the protocol travels, and `-t` is left out
because a TTY rewrites the stream. The container needs outbound HTTPS to
`backend.metacritic.com`, and nothing else: no volume, no port, no credential.

### Bundle, without npm

Download `mcp-metacritic-2.0.1.mcpb` from
[the latest release](https://github.com/smeet666/mcp-metacritic/releases/latest)
and open it. A client that supports MCP bundles installs it on its own, with no
npm and no configuration file to edit. The bundle carries its dependencies, so
nothing is fetched at install time.

## What you can ask

- "What did critics make of The Matrix?"
- "Read me a few negative reviews of that game."
- "What are the best-reviewed horror films?"
- "How does the user score compare to the Metascore?"
- "What came out recently that reviewed well?"

The ordinary path runs from a search to an entry: a row carries a `slug` and a
`kind`, and `get_title` and `get_reviews` take both together.

## Tools

| Tool            | What it does                                                |
| --------------- | ----------------------------------------------------------- |
| `search_titles` | Finds films, series and games by title.                     |
| `get_title`     | Reads one entry, its scores and its details.                |
| `get_reviews`   | Reads the reviews of one entry, by source and by sentiment. |
| `browse_titles` | Lists a catalogue by score, recency or popularity.          |

A title is addressed by its `slug` together with its `kind`, since the same slug
can name a film and a game.

### `search_titles`

Finds films, series and games by title.

| Argument | Type                                            | Required | What it does               |
| -------- | ----------------------------------------------- | -------- | -------------------------- |
| `query`  | string, at least 1 character                    | yes      | A title, or part of one.   |
| `kind`   | `movie`, `show`, `game` or `any`, default `any` | no       | Which catalogue to search. |
| `limit`  | integer, 1 to 50, default `10`                  | no       | Rows to serve.             |

**In return:** rows carrying `slug` and `kind`, which `get_title` and
`get_reviews` take together; `title`; `year`; `release_date`; `rating`, the age
rating as published; `metascore`; `user_score`; and `source_url`. **A score the
site has not computed is `null`, never `0`:** on a scale that starts at zero the
two would be indistinguishable, and a title with too few reviews carries none.

### `get_title`

Reads one entry. The heavier parts are asked for rather than served by default,
and each one beyond the default costs a request.

| Argument    | Type                                                                                                            | Required | What it does                          |
| ----------- | --------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------- |
| `slug`      | string, at least 1 character                                                                                    | yes      | The identifier a row carries.         |
| `kind`      | `movie`, `show` or `game`                                                                                       | yes      | Which catalogue it belongs to.        |
| `sections`  | array of `basic`, `scores`, `awards`, `production`, `networks`, `where_to_watch`, default `["basic", "scores"]` | no       | Which parts to return.                |
| `max_chars` | integer, 200 to 20000, default `4000`                                                                           | no       | How much of the description to serve. |
| `offset`    | integer, 0 or more, default `0`                                                                                 | no       | Where to resume the description.      |

**In return:** the entry a search row carries, plus `description`, `tagline`,
`genres`, `duration_minutes` and `imdb_id`, each `null` where the page states
nothing. `total_chars`, `returned_chars` and `offset` describe the slice of the
description served.

### `get_reviews`

Reads the reviews of one entry.

| Argument    | Type                                                      | Required | What it does                       |
| ----------- | --------------------------------------------------------- | -------- | ---------------------------------- |
| `slug`      | string, at least 1 character                              | yes      | The identifier a row carries.      |
| `kind`      | `movie`, `show` or `game`                                 | yes      | Which catalogue it belongs to.     |
| `source`    | `critic` or `user`, default `critic`                      | no       | Whose reviews to read.             |
| `sentiment` | `all`, `positive`, `neutral` or `negative`, default `all` | no       | How favourable a review has to be. |
| `limit`     | integer, 1 to 50, default `10`                            | no       | Reviews to serve.                  |
| `offset`    | integer, 0 or more, default `0`                           | no       | Reviews to skip, for paging.       |

**In return:** `reviews`, each with its `quote` as published, its `score`, the
`max` that score is out of, which is 100 for a critic and 10 for a user, and the
`publication` that ran it. **Name the publication when quoting a review.**
`total_available` counts the reviews matching the source and the sentiment asked
for, and `next_offset` continues.

### `browse_titles`

Lists a catalogue.

| Argument | Type                                            | Required | What it does                           |
| -------- | ----------------------------------------------- | -------- | -------------------------------------- |
| `kind`   | `movie`, `show` or `game`, default `movie`      | no       | Which catalogue to list.               |
| `sort`   | `score`, `recent` or `popular`, default `score` | no       | How the rows are ordered.              |
| `genre`  | string                                          | no       | A single genre name, such as `Horror`. |
| `limit`  | integer, 1 to 50, default `20`                  | no       | Rows to serve.                         |
| `offset` | integer, 0 or more, default `0`                 | no       | Rows to skip, for paging.              |

**In return:** the rows `search_titles` returns, with `total_available`,
`offset`, `next_offset` and the `kind`, `sort` and `genre` the listing was read
under.

## Two scores, two things measured

The Metascore is a weighted average of professional reviews, out of 100. The user
score is the average of what registered members gave, out of 10. They measure
different populations on different scales, and a title can carry one and not the
other. Read each with the `max` its reviews state, and report a missing score as
missing.

## Configuration

Every variable is optional. Set them in the `env` block of your client config.

| Variable                 | Default              | What it does                                                                       |
| ------------------------ | -------------------- | ---------------------------------------------------------------------------------- |
| `MC_USER_AGENT`          | the project identity | Names your application to the site, with an address where a person can be reached. |
| `MC_MIN_INTERVAL_MS`     | `1000`               | Gap between two requests, from 500 to 60000.                                       |
| `MC_TIMEOUT_MS`          | `15000`              | Deadline for one request, from 1000 to 120000.                                     |
| `MC_MAX_RETRIES`         | `3`                  | Attempts after a transient failure, from 0 to 10.                                  |
| `MC_CACHE_TTL_MS`        | `86400000`           | How long a catalogue entry stays in memory, from 0 to 604800000.                   |
| `MC_SCORES_CACHE_TTL_MS` | `3600000`            | How long scores and reviews stay in memory, from 0 to 86400000.                    |
| `MC_CACHE_MAX_ENTRIES`   | `200`                | Answers held in memory at once, from 0 to 10000.                                   |
| `MC_LOG_LEVEL`           | `error`              | `silent`, `error`, `info` or `debug`, written to stderr.                           |

Scores move as reviews come in, especially around a release, so they are held for
an hour where a catalogue entry is held for a day. A value outside its range
falls back to the default, and the reason is written to stderr.

## Errors

Every failure carries one of six codes, a message, and where it helps a hint
naming the next move.

| Code            | What happened                                           | What to do                                                                                                  |
| --------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `not_found`     | The site answered, and holds no such entry.             | Check the slug and the kind with `search_titles`.                                                           |
| `invalid_input` | The arguments were refused before any request went out. | Read the message, which names the argument.                                                                 |
| `rate_limited`  | The site asked this client to slow down.                | Wait the number of seconds the hint names and call again with the same arguments. The entry is still there. |
| `parse_failure` | The answer arrived in a shape this client cannot read.  | Report it at [the issue tracker](https://github.com/smeet666/mcp-metacritic/issues).                        |
| `network_error` | The request did not complete.                           | Try again shortly.                                                                                          |
| `timeout`       | The request passed its deadline.                        | Raise `MC_TIMEOUT_MS`, or ask for fewer rows.                                                               |

## As a library

The layer reading the site is published on its own, with its pacing, its cache
and its errors, and with no protocol attached.

```ts
import { McClient } from "mcp-metacritic/client";

const client = new McClient();
const { data, cached } = await client.getTitle({ slug: "the-matrix", kind: "movie" });
console.log(data.title, data.metascore, cached);
```

Each read answers `{ data, cached }`, and throws an error carrying one of the six
codes. The floor between two requests holds here as well.

## Pacing and attribution

Requests go out one at a time with at least a second between them, and the floor
of half a second holds however the server is configured. The `User-Agent` always
ends with the project identity and an address where a person can be reached.

Every result carries the address of the Metacritic page, and every quoted review
carries the publication that ran it. The reviews belong to their authors and to
the publications that ran them.

This MCP server is an unofficial project, with no affiliation to Metacritic.

## Privacy

This server collects nothing about you and sends nothing to its author. It runs
on your machine, contacts `backend.metacritic.com` and nothing else, holds its
answers in memory while it runs, and writes nothing to disk.
[PRIVACY.md](PRIVACY.md) states what a request carries and which settings change
any of it.

## Development

```bash
npm install
npm run build:fixtures
npm test
npm run check
```

Tests run against generated fixtures and make no network request. The live suite,
`npm run test:live`, makes one request per route and runs nightly against the
site itself.

## Contributing

Bugs, questions and ideas belong in
[the issue tracker](https://github.com/smeet666/mcp-metacritic/issues). Pull
requests are welcome; opening an issue first helps agree on the shape of the
change. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT, see [LICENSE](LICENSE). The scores and the reviews belong to Metacritic and
to the publications it quotes.

---

<a name="mcp-metacritic-français"></a>

# mcp-metacritic (français)

_[English version](#mcp-metacritic)_

[Metacritic](https://www.metacritic.com) rassemble ce que la critique et le
public ont dit des films, des séries et des jeux vidéo. Chaque fiche porte
l'année, la classification par âge, les genres, et deux notes qui lui sont
propres : le Metascore, moyenne pondérée des critiques professionnelles, et la
note des utilisateurs, sur dix, donnée par les inscrits. Sous chaque fiche se
trouvent les critiques elles-mêmes, avec la publication qui les a signées et la
phrase citée.

Ce serveur relie un client de conversation à ce catalogue. On peut y chercher un
titre, lire sa fiche avec ses notes et ses détails, parcourir un catalogue par
note, par fraîcheur ou par popularité, et lire les critiques d'un titre, filtrées
par source et par tonalité. Aucune clé d'API, aucun compte.

## Installation

**Installation en un clic**

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=metacritic&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm1jcC1tZXRhY3JpdGljIl19)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=metacritic&config=%7B%22name%22%3A%22metacritic%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22mcp-metacritic%22%5D%7D)

**Claude Code**

```bash
claude mcp add metacritic -- npx -y mcp-metacritic
```

**Claude Desktop, Cursor, et tout client au format de configuration standard**

```json
{
  "mcpServers": {
    "metacritic": {
      "command": "npx",
      "args": ["-y", "mcp-metacritic"]
    }
  }
}
```

Node 24 ou plus récent est nécessaire, et aucune variable d'environnement n'est à
renseigner.

### Avec Docker

```json
{
  "mcpServers": {
    "metacritic": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "ghcr.io/smeet666/mcp-metacritic:2.0.1"]
    }
  }
}
```

`-i` garde l'entrée standard ouverte, qui est le canal du protocole, et `-t` est
omis parce qu'un TTY réécrit le flux. Le conteneur a besoin d'un accès HTTPS
sortant vers `backend.metacritic.com`, et de rien d'autre : aucun volume, aucun
port, aucun identifiant.

### Bundle, sans npm

Téléchargez `mcp-metacritic-2.0.1.mcpb` depuis
[la dernière publication](https://github.com/smeet666/mcp-metacritic/releases/latest)
et ouvrez-le. Un client qui gère les bundles MCP l'installe seul, sans npm et
sans fichier de configuration à modifier. Le bundle emporte ses dépendances, donc
rien n'est téléchargé à l'installation.

## Ce qu'on peut demander

- « Qu'a pensé la critique de Matrix ? »
- « Lis-moi quelques critiques négatives de ce jeu. »
- « Quels sont les films d'horreur les mieux notés ? »
- « Comment la note du public se compare-t-elle au Metascore ? »
- « Qu'est-il sorti récemment qui a été bien reçu ? »

Le chemin ordinaire va d'une recherche à une fiche : une ligne porte un `slug` et
un `kind`, et `get_title` comme `get_reviews` reprennent les deux ensemble.

## Les outils

| Outil           | Ce qu'il fait                                                 |
| --------------- | ------------------------------------------------------------- |
| `search_titles` | Trouve des films, des séries et des jeux par leur titre.      |
| `get_title`     | Lit une fiche, ses notes et ses détails.                      |
| `get_reviews`   | Lit les critiques d'une fiche, par source et par tonalité.    |
| `browse_titles` | Liste un catalogue par note, par fraîcheur ou par popularité. |

Un titre s'adresse par son `slug` accompagné de son `kind`, un même slug pouvant
nommer un film et un jeu.

### `search_titles`

Trouve des films, des séries et des jeux par leur titre.

| Argument | Type                                           | Requis | Ce qu'il fait             |
| -------- | ---------------------------------------------- | ------ | ------------------------- |
| `query`  | chaîne, au moins 1 caractère                   | oui    | Un titre, ou une partie.  |
| `kind`   | `movie`, `show`, `game` ou `any`, défaut `any` | non    | Le catalogue où chercher. |
| `limit`  | entier, 1 à 50, défaut `10`                    | non    | Lignes à servir.          |

**En retour :** des lignes portant `slug` et `kind`, que `get_title` et
`get_reviews` reprennent ensemble ; `title` ; `year` ; `release_date` ; `rating`,
la classification par âge telle que publiée ; `metascore` ; `user_score` ; et
`source_url`. **Une note que le site n'a pas calculée vaut `null`, jamais `0` :**
sur une échelle qui commence à zéro les deux seraient indiscernables, et un titre
avec trop peu de critiques n'en porte aucune.

### `get_title`

Lit une fiche. Les parties lourdes se demandent au lieu d'être servies par
défaut, et chacune au-delà du défaut coûte une requête.

| Argument    | Type                                                                                                             | Requis | Ce qu'il fait                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------ |
| `slug`      | chaîne, au moins 1 caractère                                                                                     | oui    | L'identifiant d'une ligne.           |
| `kind`      | `movie`, `show` ou `game`                                                                                        | oui    | Le catalogue dont il relève.         |
| `sections`  | tableau de `basic`, `scores`, `awards`, `production`, `networks`, `where_to_watch`, défaut `["basic", "scores"]` | non    | Les parties à rendre.                |
| `max_chars` | entier, 200 à 20000, défaut `4000`                                                                               | non    | La longueur de description à servir. |
| `offset`    | entier, 0 ou plus, défaut `0`                                                                                    | non    | Où reprendre la description.         |

**En retour :** la fiche que porte une ligne de recherche, plus `description`,
`tagline`, `genres`, `duration_minutes` et `imdb_id`, chacun `null` là où la page
n'indique rien. `total_chars`, `returned_chars` et `offset` décrivent la tranche
de description servie.

### `get_reviews`

Lit les critiques d'une fiche.

| Argument    | Type                                                     | Requis | Ce qu'il fait                      |
| ----------- | -------------------------------------------------------- | ------ | ---------------------------------- |
| `slug`      | chaîne, au moins 1 caractère                             | oui    | L'identifiant d'une ligne.         |
| `kind`      | `movie`, `show` ou `game`                                | oui    | Le catalogue dont il relève.       |
| `source`    | `critic` ou `user`, défaut `critic`                      | non    | De qui lire les critiques.         |
| `sentiment` | `all`, `positive`, `neutral` ou `negative`, défaut `all` | non    | La tonalité exigée d'une critique. |
| `limit`     | entier, 1 à 50, défaut `10`                              | non    | Critiques à servir.                |
| `offset`    | entier, 0 ou plus, défaut `0`                            | non    | Critiques à sauter, pour paginer.  |

**En retour :** `reviews`, chacune avec sa `quote` telle que publiée, son
`score`, le `max` sur lequel cette note est donnée, qui vaut 100 pour un critique
et 10 pour un utilisateur, et la `publication` qui l'a signée. **Nommez la
publication quand vous citez une critique.** `total_available` compte les
critiques correspondant à la source et à la tonalité demandées, et `next_offset`
poursuit.

### `browse_titles`

Liste un catalogue.

| Argument | Type                                           | Requis | Ce qu'il fait                         |
| -------- | ---------------------------------------------- | ------ | ------------------------------------- |
| `kind`   | `movie`, `show` ou `game`, défaut `movie`      | non    | Le catalogue à lister.                |
| `sort`   | `score`, `recent` ou `popular`, défaut `score` | non    | L'ordre des lignes.                   |
| `genre`  | chaîne                                         | non    | Un seul nom de genre, comme `Horror`. |
| `limit`  | entier, 1 à 50, défaut `20`                    | non    | Lignes à servir.                      |
| `offset` | entier, 0 ou plus, défaut `0`                  | non    | Lignes à sauter, pour paginer.        |

**En retour :** les lignes que rend `search_titles`, avec `total_available`,
`offset`, `next_offset` et les `kind`, `sort` et `genre` sous lesquels la liste a
été lue.

## Deux notes, deux choses mesurées

Le Metascore est une moyenne pondérée des critiques professionnelles, sur 100. La
note des utilisateurs est la moyenne de ce qu'ont donné les membres inscrits, sur 10. Elles mesurent des populations différentes sur des échelles différentes, et
un titre peut porter l'une sans l'autre. Lisez chacune avec le `max` que ses
critiques indiquent, et rapportez une note absente comme absente.

## Configuration

Chaque variable est facultative. Elles se posent dans le bloc `env` de la
configuration du client.

| Variable                 | Défaut               | Ce qu'elle fait                                                                    |
| ------------------------ | -------------------- | ---------------------------------------------------------------------------------- |
| `MC_USER_AGENT`          | l'identité du projet | Nomme votre application auprès du site, avec une adresse où joindre une personne.  |
| `MC_MIN_INTERVAL_MS`     | `1000`               | Écart entre deux requêtes, de 500 à 60000.                                         |
| `MC_TIMEOUT_MS`          | `15000`              | Délai d'une requête, de 1000 à 120000.                                             |
| `MC_MAX_RETRIES`         | `3`                  | Tentatives après un échec passager, de 0 à 10.                                     |
| `MC_CACHE_TTL_MS`        | `86400000`           | Durée pendant laquelle une fiche reste en mémoire, de 0 à 604800000.               |
| `MC_SCORES_CACHE_TTL_MS` | `3600000`            | Durée pendant laquelle les notes et critiques restent en mémoire, de 0 à 86400000. |
| `MC_CACHE_MAX_ENTRIES`   | `200`                | Réponses gardées en mémoire à la fois, de 0 à 10000.                               |
| `MC_LOG_LEVEL`           | `error`              | `silent`, `error`, `info` ou `debug`, écrit sur la sortie d'erreur.                |

Les notes bougent au fil des critiques, surtout autour d'une sortie, donc elles
sont gardées une heure là où une fiche l'est un jour. Une valeur hors de sa plage
retombe sur le défaut, et la raison est écrite sur la sortie d'erreur.

## Erreurs

Chaque échec porte un des six codes, un message, et quand cela aide une
indication du geste suivant.

| Code            | Ce qui s'est passé                                   | Que faire                                                                                       |
| --------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `not_found`     | Le site a répondu, et n'a pas cette fiche.           | Vérifiez le slug et le type avec `search_titles`.                                               |
| `invalid_input` | Les arguments ont été refusés avant toute requête.   | Lisez le message, qui nomme l'argument.                                                         |
| `rate_limited`  | Le site demande à ce client de ralentir.             | Attendez les secondes indiquées et rappelez avec les mêmes arguments. La fiche est toujours là. |
| `parse_failure` | La réponse est arrivée dans une forme illisible ici. | Signalez-le sur [le suivi d'incidents](https://github.com/smeet666/mcp-metacritic/issues).      |
| `network_error` | La requête n'a pas abouti.                           | Réessayez sous peu.                                                                             |
| `timeout`       | La requête a dépassé son délai.                      | Augmentez `MC_TIMEOUT_MS`, ou demandez moins de lignes.                                         |

## Comme bibliothèque

La couche qui lit le site est publiée seule, avec son rythme, son cache et ses
erreurs, sans protocole attaché.

```ts
import { McClient } from "mcp-metacritic/client";

const client = new McClient();
const { data, cached } = await client.getTitle({ slug: "the-matrix", kind: "movie" });
console.log(data.title, data.metascore, cached);
```

Chaque lecture répond `{ data, cached }`, et lève une erreur portant un des six
codes. Le plancher entre deux requêtes tient également ici.

## Rythme et attribution

Les requêtes partent une à une avec au moins une seconde entre elles, et le
plancher d'une demi-seconde tient quelle que soit la configuration. Le
`User-Agent` se termine toujours par l'identité du projet et une adresse où
joindre une personne.

Chaque résultat porte l'adresse de la page Metacritic, et chaque critique citée
porte la publication qui l'a signée. Les critiques appartiennent à leurs auteurs
et aux publications qui les ont publiées.

Ce MCP est un projet non officiel, sans affiliation à Metacritic.

## Confidentialité

Ce serveur ne collecte rien sur vous et n'envoie rien à son auteur. Il tourne sur
votre machine, ne joint que `backend.metacritic.com`, garde ses réponses en
mémoire le temps qu'il tourne, et n'écrit rien sur le disque.
[PRIVACY.md](PRIVACY.md) dit ce qu'une requête emporte et quels réglages changent
cela.

## Développement

```bash
npm install
npm run build:fixtures
npm test
npm run check
```

Les tests s'exécutent sur des fixtures engendrées et n'émettent aucune requête.
La suite en direct, `npm run test:live`, émet une requête par route et tourne
chaque nuit contre le site lui-même.

## Contribuer

Les anomalies, les questions et les idées ont leur place dans
[le suivi d'incidents](https://github.com/smeet666/mcp-metacritic/issues). Les
propositions de modification sont bienvenues ; ouvrir un ticket d'abord aide à
s'accorder sur la forme du changement. Voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT, voir [LICENSE](LICENSE). Les notes et les critiques appartiennent à
Metacritic et aux publications qu'il cite.
