# mcp-metacritic

[![npm](https://img.shields.io/npm/v/mcp-metacritic.svg)](https://www.npmjs.com/package/mcp-metacritic)
[![CI](https://github.com/smeet666/mcp-metacritic/actions/workflows/ci.yml/badge.svg)](https://github.com/smeet666/mcp-metacritic/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/mcp-metacritic.svg)](./LICENSE)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-6E56CF)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.smeet666/mcp-metacritic)
[![Glama](https://glama.ai/mcp/servers/smeet666/mcp-metacritic/badges/score.svg)](https://glama.ai/mcp/servers/smeet666/mcp-metacritic)
[![M8ven Score](https://m8ven.ai/badge/mcp/smeet666-mcp-metacritic-1yvblv)](https://m8ven.ai/mcp/smeet666-mcp-metacritic-1yvblv)
[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=metacritic&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm1jcC1tZXRhY3JpdGljIl19)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=metacritic&config=%7B%22name%22%3A%22metacritic%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22mcp-metacritic%22%5D%7D)

An [MCP](https://modelcontextprotocol.io) server for
[Metacritic](https://www.metacritic.com). Search films, shows and games, read
Metascores and audience scores, and quote what individual critics wrote, with
the publication named and the article linked. **No API key, no account, no
configuration.**

_(Version française plus bas / [French version below](#mcp-metacritic-français))_

---

## Quickstart

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

**Bundle, without npm**

Download `mcp-metacritic-<version>.mcpb` from
[the latest release](https://github.com/smeet666/mcp-metacritic/releases/latest) and open
it. A client that supports MCP bundles installs it on its own, with no npm and
no configuration file to edit. The bundle carries its dependencies, so nothing
is fetched at install time.

## Tools

| Tool            | What it does                                                | Key parameters                                    |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| `search_titles` | Finds films, shows and games by title. Compact rows.        | `query`, `kind`, `limit`                          |
| `get_title`     | Reads one entry, section by section.                        | `slug`, `kind`, `sections`, `max_chars`, `offset` |
| `get_reviews`   | Individual critic or audience reviews, filtered by verdict. | `slug`, `kind`, `source`, `sentiment`, `limit`    |
| `browse_titles` | Rankings: best rated, newest, most looked at.               | `kind`, `sort`, `genre`, `limit`, `offset`        |

Search returns a `slug` and a `kind` for every result, and the other tools take
both. That is the intended chain: search, then read.

The server is **read-only**. It writes nothing back to Metacritic.

### Things worth knowing

**The two scores are on different scales.** The critic Metascore runs to 100 and
the audience score to 10, so 73 and 8.9 describe similar opinions. Every score
this server returns carries its own `max`, and the tool descriptions say so,
because averaging the two is the single easiest mistake to make with this data.

**Sections are opt-in because an entry is large.** A detail response is 46 KB
for a film, most of it artwork variants. `get_title` returns `basic` and
`scores` by default; `awards`, `production`, `networks` and `where_to_watch`
cost an extra request each and are only fetched when asked for.

**Reviews are a sample, not a page.** Metacritic counts 36 critic reviews on a
given film and serves 7 through this route, whatever paging you ask for. The
tool says so rather than presenting the sample as the whole list, and links the
entry page where the rest can be read.

**A failure is never an empty result.** Every response carries either a `data`
object or an `errors` array, and this server reads that distinction rather than
guessing. A missing entry produces an error with a code; a request that could
not be made says it could not be made, and never that Metacritic publishes
nothing. Those are very different answers and a model cannot tell them apart on
its own.

**Search matches titles, and nothing else.** It cannot find an entry from a
plot detail, a person or a studio, it cannot page, and for a multi-word query
the site counts matches loosely: "the matrix" reports over 55 000 entries
because it counts anything matching either word.

**Browse paging is approximate.** Metacritic does not order tied entries
stably, so an entry can appear on two consecutive pages. Deduplicate by slug
rather than counting rows.

## Configuration

Every variable is optional. Set them in the `env` block of your MCP client config.

| Variable                 | Default                              | Purpose                                                        |
| ------------------------ | ------------------------------------ | -------------------------------------------------------------- |
| `MC_USER_AGENT`          | `mcp-metacritic v<version> (<repo>)` | User-Agent sent to Metacritic.                                 |
| `MC_MIN_INTERVAL_MS`     | `1000`                               | Minimum gap between requests. Values below 500 ms are ignored. |
| `MC_TIMEOUT_MS`          | `15000`                              | Per-request timeout.                                           |
| `MC_MAX_RETRIES`         | `3`                                  | Retries on refusals and transient errors.                      |
| `MC_CACHE_TTL_MS`        | `86400000`                           | Catalogue cache lifetime (24 hours).                           |
| `MC_SCORES_CACHE_TTL_MS` | `3600000`                            | Scores and reviews cache lifetime (1 hour).                    |
| `MC_CACHE_MAX_ENTRIES`   | `200`                                | In-memory cache size.                                          |
| `MC_LOG_LEVEL`           | `error`                              | `silent`, `error`, `info` or `debug`. Logs go to stderr.       |

A User-Agent claiming to be a browser has the project's own identity appended
to it, so the traffic stays attributable whatever a caller sets.

## How it works

Metacritic's website is served by a JSON backend at
`backend.metacritic.com`, and this server calls the same routes its own pages
call. It sends one request at a time, paces itself, backs off when refused, and
keeps two in-memory caches: a day for catalogue entries, which change when
someone edits them, and an hour for scores and reviews, which move as reviews
land.

Streaming links arrive wrapped in click-tracking redirects of around 800
characters, with the real destination inside. This server unwraps them: you get
the provider's own URL, not a tracker.

### On the terms of use

`metacritic.com/terms-of-use/` returns 404, so the terms could not be read.
This is worth stating plainly rather than leaving implicit.

What is verifiable: the backend host serves no `robots.txt` at all, requires no
API key, and did not throttle ten consecutive requests during testing. Those
are the conditions this server operates under, and it does not take them as
permission to be greedy. It sends one request per second at most, identifies
itself, caches what it reads, and carries a link back to Metacritic on every
result, including on every quoted review.

If Metacritic would rather it did not exist, opening an issue is enough.

## Development

```bash
npm install
npm run build:fixtures   # regenerate the JSON test fixtures
npm test                 # unit tests, no network
npm run typecheck
npm run build
MC_LIVE=1 npm run test:live   # hits the real site, excluded from CI
npm run inspector        # explore the tools in the MCP Inspector
```

Fixtures are generated, not captured: every title, quote, publication and
studio in `test/fixtures` is invented, so the tests are deterministic and no
third-party content lives in this repository.

The API layer (`src/mc`) does not import the MCP SDK and is published
separately as `mcp-metacritic/client`, so it can be used as a plain library. It
enforces the pacing floor and the identifying User-Agent itself, so those hold
for a library consumer too.

## Reviews, scores and copyright

Metascores, review texts and the editorial work behind them belong to
Metacritic and to the publications it aggregates. This project claims no rights
over them and ships none of their content.

Review quotes are returned as excerpts, capped in length, always with the
publication named and with a link to the original article where the site
provides one. If you repeat a quote, keep both. If you cite a score, credit
Metacritic and link the entry: every result carries a `source_url`.

This is an unofficial project, with no affiliation to or endorsement by
Metacritic or Fandom.

## Contributing

Bugs, questions and ideas all belong in
[the issue tracker](https://github.com/smeet666/mcp-metacritic/issues). Pull requests
are welcome; please open an issue first so we can agree on what the right
answer is before you write it. [CONTRIBUTING.md](CONTRIBUTING.md) has the
detail, and [SECURITY.md](SECURITY.md) covers anything exploitable.

## Support

These servers are free and stay free. If one of them saved you an afternoon,
you can [buy me a coffee](https://buymeacoffee.com/smeet666).

## License

MIT. See [LICENSE](./LICENSE). The license covers this source code only, not the
data retrieved through it.

---

<a name="mcp-metacritic-français"></a>

# mcp-metacritic (français)

Un serveur [MCP](https://modelcontextprotocol.io) pour
[Metacritic](https://www.metacritic.com). Cherchez des films, séries et jeux,
lisez les Metascores et les notes du public, et citez ce qu'ont écrit les
critiques, avec la publication nommée et l'article lié. **Sans clé d'API, sans
compte, sans configuration.**

## Démarrage rapide

**Installation en un clic**

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=metacritic&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm1jcC1tZXRhY3JpdGljIl19)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=metacritic&config=%7B%22name%22%3A%22metacritic%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22mcp-metacritic%22%5D%7D)

**Claude Code**

```bash
claude mcp add metacritic -- npx -y mcp-metacritic
```

**Claude Desktop, Cursor, et tout client utilisant le format standard**

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

**Bundle, sans npm**

Téléchargez `mcp-metacritic-<version>.mcpb` depuis
[la dernière release](https://github.com/smeet666/mcp-metacritic/releases/latest) et
ouvrez-le. Un client compatible avec les bundles MCP l'installe seul, sans npm
ni fichier de configuration à modifier. Le bundle embarque ses dépendances,
donc rien n'est téléchargé à l'installation.

## Outils

| Outil           | Rôle                                                      | Paramètres principaux                             |
| --------------- | --------------------------------------------------------- | ------------------------------------------------- |
| `search_titles` | Trouve films, séries et jeux par titre. Lignes compactes. | `query`, `kind`, `limit`                          |
| `get_title`     | Lit une fiche, section par section.                       | `slug`, `kind`, `sections`, `max_chars`, `offset` |
| `get_reviews`   | Critiques presse ou public, filtrables par verdict.       | `slug`, `kind`, `source`, `sentiment`, `limit`    |
| `browse_titles` | Classements : mieux notés, plus récents, plus consultés.  | `kind`, `sort`, `genre`, `limit`, `offset`        |

La recherche renvoie un `slug` et un `kind` pour chaque résultat, que les autres
outils reprennent. C'est l'enchaînement prévu : chercher, puis lire.

Le serveur est en **lecture seule**. Il n'écrit rien vers Metacritic.

### Ce qu'il faut savoir

**Les deux notes ne sont pas sur la même échelle.** Le Metascore critique va
jusqu'à 100 et la note du public jusqu'à 10, donc 73 et 8,9 décrivent des avis
voisins. Chaque note renvoyée porte son propre `max`, et les descriptions
d'outils le disent, parce que les additionner est l'erreur la plus facile à
commettre avec ces données.

**Les sections sont à la demande, car une fiche est volumineuse.** Une réponse
de détail fait 46 Ko pour un film, essentiellement des variantes d'illustration.
`get_title` renvoie `basic` et `scores` par défaut ; `awards`, `production`,
`networks` et `where_to_watch` coûtent une requête chacune et ne sont récupérées
que si on les demande.

**Les critiques sont un échantillon, pas une page.** Metacritic en compte 36 sur
un film donné et en sert 7 par cette route, quelle que soit la pagination
demandée. L'outil le dit au lieu de présenter l'échantillon comme la liste
complète, et renvoie vers la fiche où le reste se lit.

**Un échec n'est jamais un résultat vide.** Chaque réponse porte soit un objet
`data`, soit un tableau `errors`, et ce serveur lit cette distinction au lieu de
la deviner. Une fiche absente produit une erreur avec un code ; une requête qui
n'a pas abouti dit qu'elle n'a pas abouti, jamais que Metacritic ne publie rien.
Ce sont deux réponses très différentes, qu'un modèle ne peut pas distinguer seul.

**La recherche porte sur les titres, et rien d'autre.** Elle ne retrouve pas une
fiche depuis un élément d'intrigue, une personne ou un studio, elle ne pagine
pas, et sur une requête de plusieurs mots le site compte large : « the matrix »
annonce plus de 55 000 entrées parce qu'il compte tout ce qui correspond à l'un
des deux mots.

**La pagination des classements est approximative.** Metacritic n'ordonne pas
les ex æquo de façon stable, donc une entrée peut apparaître sur deux pages
consécutives. Dédoublonnez par slug plutôt que de compter les lignes.

## Configuration

Toutes les variables sont optionnelles, à déclarer dans le bloc `env` de votre client.

| Variable                 | Défaut                                | Rôle                                                              |
| ------------------------ | ------------------------------------- | ----------------------------------------------------------------- |
| `MC_USER_AGENT`          | `mcp-metacritic v<version> (<dépôt>)` | User-Agent envoyé à Metacritic.                                   |
| `MC_MIN_INTERVAL_MS`     | `1000`                                | Écart minimal entre requêtes. Sous 500 ms, la valeur est ignorée. |
| `MC_TIMEOUT_MS`          | `15000`                               | Délai d'attente par requête.                                      |
| `MC_MAX_RETRIES`         | `3`                                   | Tentatives en cas de refus ou d'erreur passagère.                 |
| `MC_CACHE_TTL_MS`        | `86400000`                            | Durée de vie du cache catalogue (24 heures).                      |
| `MC_SCORES_CACHE_TTL_MS` | `3600000`                             | Durée de vie du cache notes et critiques (1 heure).               |
| `MC_CACHE_MAX_ENTRIES`   | `200`                                 | Taille des caches mémoire.                                        |
| `MC_LOG_LEVEL`           | `error`                               | `silent`, `error`, `info` ou `debug`. Logs sur stderr.            |

Un User-Agent se faisant passer pour un navigateur se voit adjoindre l'identité
du projet, pour que le trafic reste attribuable quoi que règle l'appelant.

## Fonctionnement

Le site de Metacritic est servi par un backend JSON à `backend.metacritic.com`,
et ce serveur appelle les mêmes routes que leurs propres pages. Il envoie une
requête à la fois, s'impose un rythme, ralentit en cas de refus, et garde deux
caches mémoire : un jour pour les fiches, qui ne bougent qu'à l'édition, et une
heure pour les notes et critiques, qui évoluent au fil des publications.

Les liens de streaming arrivent enveloppés dans des redirections publicitaires
d'environ 800 caractères, avec la vraie destination à l'intérieur. Ce serveur
les déballe : vous obtenez l'URL du fournisseur, pas celle d'un traqueur.

### À propos des conditions d'utilisation

`metacritic.com/terms-of-use/` renvoie une 404, les conditions n'ont donc pas pu
être lues. Autant le dire clairement plutôt que de le passer sous silence.

Ce qui est vérifiable : l'hôte du backend ne sert aucun `robots.txt`, ne demande
aucune clé, et n'a ralenti aucune de dix requêtes consécutives lors des tests.
Ce sont les conditions dans lesquelles ce serveur opère, et il n'y voit pas une
autorisation d'être gourmand. Il envoie au plus une requête par seconde,
s'identifie, met en cache ce qu'il lit, et porte un lien vers Metacritic sur
chaque résultat, y compris sur chaque critique citée.

Si Metacritic préfère qu'il n'existe pas, ouvrir une issue suffit.

## Développement

```bash
npm install
npm run build:fixtures   # régénère les fixtures JSON de test
npm test                 # tests unitaires, sans réseau
npm run typecheck
npm run build
MC_LIVE=1 npm run test:live   # touche le vrai site, exclu de la CI
npm run inspector        # explorer les outils dans le MCP Inspector
```

Les fixtures sont générées, pas capturées : chaque titre, citation, publication
et studio de `test/fixtures` est inventé, ce qui rend les tests déterministes et
évite de stocker du contenu tiers dans ce dépôt.

La couche API (`src/mc`) n'importe pas le SDK MCP et est publiée séparément sous
`mcp-metacritic/client`, utilisable comme simple bibliothèque. Elle applique
elle-même le plancher de cadence et le User-Agent identifiant, qui valent donc
aussi pour qui l'utilise en bibliothèque.

## Critiques, notes et droits d'auteur

Les Metascores, les textes de critiques et le travail éditorial qui les
sous-tend appartiennent à Metacritic et aux publications qu'il agrège. Ce projet
ne revendique aucun droit dessus et n'embarque aucun de leurs contenus.

Les citations sont renvoyées sous forme d'extraits, de longueur bornée, toujours
avec la publication nommée et un lien vers l'article d'origine quand le site en
fournit un. Si vous reprenez une citation, conservez les deux. Si vous citez une
note, créditez Metacritic et liez la fiche : chaque résultat porte un
`source_url`.

Projet non officiel, sans affiliation à Metacritic ou Fandom ni approbation de
leur part.

## Licence

MIT, voir [LICENSE](./LICENSE). La licence couvre uniquement le code source, pas
les données récupérées par son intermédiaire.
