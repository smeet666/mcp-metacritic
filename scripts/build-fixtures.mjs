#!/usr/bin/env node
/**
 * Generates the JSON fixtures the unit tests read.
 *
 * Every title, quote, publication and person here is invented. Nothing in this
 * file was captured from Metacritic: the fixtures reproduce the *shape* of the
 * upstream envelopes, which is what the parser is a contract with, and none of
 * their content.
 *
 * Each payload deliberately carries fields the parser has no business reading
 * (`__noise`, artwork variants, platform lists). A parser that copies whole
 * objects through instead of picking fields will leak them into a result, and
 * the listing tests assert that it does not.
 *
 * Plain Node ESM, no dependencies, so `npm run build:fixtures` works on a clean
 * checkout. Output is byte-stable: same input, same bytes, and .prettierignore
 * keeps a formatter from rewriting what the broken fixtures exist to test.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures");

/** Artwork variants: bulky, useless to a model, and the main thing to strip. */
const images = (slug) => [
  {
    filename: `${slug}-poster-1440x2160.jpg`,
    height: 2160,
    width: 1440,
    alt: `${slug} poster`,
    bucketType: "poster",
    bucketPath: `/a/img/catalog/provider/${slug}/1440x2160.jpg`,
  },
  {
    filename: `${slug}-still-1920x1080.jpg`,
    height: 1080,
    width: 1920,
    alt: `${slug} still`,
    bucketType: "backdrop",
    bucketPath: `/a/img/catalog/provider/${slug}/1920x1080.jpg`,
  },
];

const searchRow = (over) => ({
  id: 2_000_100_000,
  type: "movie",
  typeId: 2,
  title: "Untitled",
  slug: "untitled",
  premiereYear: 2019,
  releaseDate: "2019-05-03",
  rating: "R",
  criticScoreSummary: { score: 50, url: "/movie/untitled/critic-reviews/", max: 100 },
  description: "No description.",
  genres: [{ id: 1, name: "Drama" }],
  duration: 100,
  platforms: [],
  images: images("untitled"),
  __noise: "field the parser must ignore",
  ...over,
});

/**
 * Search rows carry no audience score at all: the field is absent, not zero.
 * Browse rows carry `userScore: { score }`. Both are represented so the tests
 * can prove absence yields null rather than 0.
 */
const SEARCH = {
  data: {
    totalResults: 17,
    itemsPerPage: 10,
    links: { self: { href: "/finder/metacritic/search/lantern/web" } },
    items: [
      searchRow({
        id: 2_000_100_001,
        type: "movie",
        typeId: 2,
        title: "Blue Horizon",
        slug: "blue-horizon",
        premiereYear: 2011,
        releaseDate: "2011-09-30",
        rating: "R",
        criticScoreSummary: { score: 81, url: "/movie/blue-horizon/critic-reviews/", max: 100 },
        description:
          "A lighthouse keeper counts the ships that never come back, and starts writing to one of them.",
        genres: [
          { id: 4, name: "Neo-Noir" },
          { id: 7, name: "Drama" },
        ],
        duration: 112,
        images: images("blue-horizon"),
      }),
      searchRow({
        id: 2_000_100_002,
        type: "show",
        typeId: 1,
        title: "Paper Lanterns",
        slug: "paper-lanterns",
        premiereYear: 2018,
        releaseDate: "2018-02-14",
        rating: "TV-MA",
        criticScoreSummary: { score: 67, url: "/tv/paper-lanterns/critic-reviews/", max: 100 },
        description: "Three sisters run a failing print shop in a town that floods every spring.",
        genres: [{ id: 7, name: "Drama" }],
        duration: 45,
        images: images("paper-lanterns"),
      }),
      searchRow({
        id: 2_000_100_003,
        type: "game-title",
        typeId: 13,
        title: "Cinder Vale",
        slug: "cinder-vale",
        premiereYear: 2023,
        releaseDate: "2023-11-07",
        rating: "M",
        criticScoreSummary: { score: 88, url: "/game/cinder-vale/critic-reviews/", max: 100 },
        description: "A survival game about rebuilding a valley after the ash falls.",
        genres: [{ id: 12, name: "Survival" }],
        duration: null,
        platforms: [
          { id: 3, name: "PC" },
          { id: 9, name: "PlayStation 5" },
        ],
        images: images("cinder-vale"),
      }),
      searchRow({
        id: 2_000_100_004,
        type: "movie",
        typeId: 2,
        title: "The Salt Road",
        slug: "the-salt-road",
        premiereYear: 1997,
        releaseDate: "1997-06-20",
        rating: null,
        criticScoreSummary: {},
        description: "A caravan crosses a desert that is no longer on any map.",
        genres: [{ id: 2, name: "Adventure" }],
        duration: 126,
        images: images("the-salt-road"),
      }),
    ],
  },
};

const browseRow = (over) => ({
  ...searchRow(over),
  userScore: { score: 7.5, max: 10, reviewCount: 400 },
  ...over,
});

const BROWSE = {
  data: {
    totalResults: 320,
    itemsPerPage: 24,
    items: [
      browseRow({
        id: 2_000_100_001,
        type: "movie",
        typeId: 2,
        title: "Blue Horizon",
        slug: "blue-horizon",
        premiereYear: 2011,
        releaseDate: "2011-09-30",
        rating: "R",
        criticScoreSummary: { score: 81, max: 100 },
        userScore: { score: 8.8, max: 10, reviewCount: 1204 },
        description: "A lighthouse keeper counts the ships that never come back.",
        genres: [{ id: 4, name: "Neo-Noir" }],
        images: images("blue-horizon"),
      }),
      browseRow({
        id: 2_000_100_005,
        type: "movie",
        typeId: 2,
        title: "Vermilion Hours",
        slug: "vermilion-hours",
        premiereYear: 2004,
        releaseDate: "2004-10-15",
        rating: "PG-13",
        criticScoreSummary: { score: 76, max: 100 },
        userScore: { score: 6.1, max: 10, reviewCount: 88 },
        description: "A night nurse and a taxi driver keep meeting at the same red light.",
        genres: [{ id: 7, name: "Drama" }],
        images: images("vermilion-hours"),
      }),
      browseRow({
        id: 2_000_100_006,
        type: "movie",
        typeId: 2,
        title: "Gravel Choir",
        slug: "gravel-choir",
        premiereYear: 2021,
        releaseDate: "2021-03-05",
        rating: "R",
        criticScoreSummary: { score: 64, max: 100 },
        // A brand-new entry with no audience score yet: the key is present and
        // the score inside it is null, which must not read as zero either.
        userScore: { score: null, max: 10, reviewCount: 0 },
        description: "A quarry town choir goes on tour and comes back one voice short.",
        genres: [{ id: 8, name: "Musical" }],
        images: images("gravel-choir"),
      }),
    ],
  },
};

/** The detail route carries no `type`, so kind can only come from the caller. */
const DETAIL_MOVIE = {
  data: {
    item: {
      id: 2_000_100_001,
      title: "Blue Horizon",
      slug: "blue-horizon",
      premiereYear: 2011,
      releaseDate: "2011-09-30",
      rating: "R",
      description:
        "A lighthouse keeper counts the ships that never come back, and starts writing to one of them.\nThe letters are answered.",
      tagline: "Some lights are warnings.",
      genres: [
        { id: 4, name: "Neo-Noir" },
        { id: 7, name: "Drama" },
      ],
      // Minutes as an integer, which is how the site reports a runtime.
      duration: 112,
      imdbId: "tt0910111",
      networks: [],
      production: {
        companies: [
          { id: 501, name: "Nine Fathoms Pictures" },
          { id: 502, name: "Cold Coast Films" },
        ],
      },
      // Awards arrive as one entry per ceremony, counting wins and nominations
      // rather than naming categories. A ceremony with no win reports null
      // rather than 0, and the last entry names no ceremony at all, which
      // leaves nothing to attribute the tally to.
      awards: [
        { awardEvent: "Torrance Film Prize", wins: 4, nominations: 8 },
        { awardEvent: "Coastal Critics Circle", wins: null, nominations: 3 },
        { awardEvent: "Harbour Guild Awards", wins: 9, nominations: 19 },
        { wins: 1, nominations: 2 },
      ],
      criticScoreSummary: { score: 81, max: 100, reviewCount: 42 },
      images: images("blue-horizon"),
      __noise: { cast: [{ name: "Ada Fenwick", role: "Keeper" }], trailers: [] },
    },
  },
};

const DETAIL_GAME = {
  data: {
    item: {
      id: 2_000_100_003,
      title: "Cinder Vale",
      slug: "cinder-vale",
      premiereYear: 2023,
      releaseDate: "2023-11-07",
      rating: "M",
      description: "A survival game about rebuilding a valley after the ash falls.",
      tagline: null,
      genres: [{ id: 12, name: "Survival" }],
      duration: null,
      imdbId: null,
      networks: [],
      production: { companies: [{ id: 777, name: "Hollow Lamp Studio" }] },
      awards: [],
      criticScoreSummary: { score: 88, max: 100, reviewCount: 61 },
      platforms: [{ id: 3, name: "PC" }],
      images: images("cinder-vale"),
    },
  },
};

const SCORE_CRITIC = {
  data: {
    item: {
      score: 73,
      max: 100,
      reviewCount: 36,
      positiveCount: 30,
      neutralCount: 5,
      negativeCount: 1,
      sentiment: "Generally favorable",
      __noise: { distribution: [1, 5, 30] },
    },
  },
};

/** User scores are decimals out of 10, which is why `max` cannot be assumed. */
const SCORE_USER = {
  data: {
    item: {
      score: 8.9,
      max: 10,
      reviewCount: 1204,
      positiveCount: 1010,
      neutralCount: 140,
      negativeCount: 54,
      sentiment: "Universal acclaim",
    },
  },
};

/** A score document with everything except the scale it is on. */
const SCORE_NO_MAX = {
  data: {
    item: {
      score: 73,
      reviewCount: 36,
      positiveCount: 30,
      neutralCount: 5,
      negativeCount: 1,
      sentiment: "Generally favorable",
    },
  },
};

const criticReview = (over) => ({
  quote: "No quote.",
  score: 50,
  url: "https://example.invalid/review",
  author: "Anonymous",
  authorSlug: "anonymous",
  publicationName: "The Example Herald",
  publicationSlug: "the-example-herald",
  date: "2011-10-01",
  reviewId: 1,
  __noise: { platform: null, tags: [] },
  ...over,
});

/**
 * The four buckets have deliberately different lengths and no shared quotes:
 * a cache that keys on the URL alone serves the first bucket to all four, and
 * the only way to catch that is for the buckets to be distinguishable.
 */
const REVIEWS_CRITIC = {
  data: {
    totalResults: 36,
    item: {
      default: [
        criticReview({
          reviewId: 11,
          quote: "A film that trusts its silences, and is right to.",
          score: 91,
          author: "Marisol Vane",
          authorSlug: "marisol-vane",
          publicationName: "The Harbour Review",
          publicationSlug: "the-harbour-review",
          url: "https://example.invalid/harbour/blue-horizon",
          date: "2011-10-01",
        }),
        criticReview({
          reviewId: 12,
          quote: "Two hours of weather and grief, beautifully shot.",
          score: 84,
          author: "Ines Kavanagh",
          authorSlug: "ines-kavanagh",
          publicationName: "Northern Screen",
          publicationSlug: "northern-screen",
          url: "https://example.invalid/northern/blue-horizon",
          date: "2011-10-03",
        }),
        criticReview({
          reviewId: 13,
          quote: "The letters device strains, but the lead does not.",
          score: 70,
          author: "Peter Oduya",
          authorSlug: "peter-oduya",
          publicationName: "Reel Quarterly",
          publicationSlug: "reel-quarterly",
          url: "https://example.invalid/reel/blue-horizon",
          date: "2011-10-05",
        }),
        criticReview({
          reviewId: 14,
          quote: "Handsome and inert in roughly equal measure.",
          score: 58,
          author: "Dana Whitlock",
          authorSlug: "dana-whitlock",
          publicationName: "The Evening Ledger",
          publicationSlug: "the-evening-ledger",
          url: "https://example.invalid/ledger/blue-horizon",
          date: "2011-10-06",
        }),
        criticReview({
          reviewId: 15,
          quote: "A postcard mistaken for a novel.",
          score: 40,
          author: "Bram Selig",
          authorSlug: "bram-selig",
          publicationName: "Cut & Print",
          publicationSlug: "cut-and-print",
          url: "https://example.invalid/cutprint/blue-horizon",
          date: "2011-10-09",
        }),
        criticReview({
          reviewId: 16,
          quote: "The best lighthouse in cinema since the last one.",
          score: 88,
          author: "Halvor Reyes",
          authorSlug: "halvor-reyes",
          publicationName: "Screen Compass",
          publicationSlug: "screen-compass",
          url: "https://example.invalid/compass/blue-horizon",
          date: "2011-10-11",
        }),
        criticReview({
          reviewId: 17,
          quote: "Slow, and knows exactly what it is doing with the time.",
          score: 79,
          author: "Cleo Marchetti",
          authorSlug: "cleo-marchetti",
          publicationName: "The Long Take",
          publicationSlug: "the-long-take",
          url: "https://example.invalid/longtake/blue-horizon",
          date: "2011-10-14",
        }),
      ],
      positive: [
        criticReview({
          reviewId: 11,
          quote: "A film that trusts its silences, and is right to.",
          score: 91,
          author: "Marisol Vane",
          authorSlug: "marisol-vane",
          publicationName: "The Harbour Review",
          publicationSlug: "the-harbour-review",
          url: "https://example.invalid/harbour/blue-horizon",
          date: "2011-10-01",
        }),
        criticReview({
          reviewId: 16,
          quote: "The best lighthouse in cinema since the last one.",
          score: 88,
          author: "Halvor Reyes",
          authorSlug: "halvor-reyes",
          publicationName: "Screen Compass",
          publicationSlug: "screen-compass",
          url: "https://example.invalid/compass/blue-horizon",
          date: "2011-10-11",
        }),
        criticReview({
          reviewId: 12,
          quote: "Two hours of weather and grief, beautifully shot.",
          score: 84,
          author: "Ines Kavanagh",
          authorSlug: "ines-kavanagh",
          publicationName: "Northern Screen",
          publicationSlug: "northern-screen",
          url: "https://example.invalid/northern/blue-horizon",
          date: "2011-10-03",
        }),
        criticReview({
          reviewId: 17,
          quote: "Slow, and knows exactly what it is doing with the time.",
          score: 79,
          author: "Cleo Marchetti",
          authorSlug: "cleo-marchetti",
          publicationName: "The Long Take",
          publicationSlug: "the-long-take",
          url: "https://example.invalid/longtake/blue-horizon",
          date: "2011-10-14",
        }),
      ],
      neutral: [
        criticReview({
          reviewId: 13,
          quote: "The letters device strains, but the lead does not.",
          score: 70,
          author: "Peter Oduya",
          authorSlug: "peter-oduya",
          publicationName: "Reel Quarterly",
          publicationSlug: "reel-quarterly",
          url: "https://example.invalid/reel/blue-horizon",
          date: "2011-10-05",
        }),
        criticReview({
          reviewId: 14,
          quote: "Handsome and inert in roughly equal measure.",
          score: 58,
          author: "Dana Whitlock",
          authorSlug: "dana-whitlock",
          publicationName: "The Evening Ledger",
          publicationSlug: "the-evening-ledger",
          url: "https://example.invalid/ledger/blue-horizon",
          date: "2011-10-06",
        }),
      ],
      negative: [
        criticReview({
          reviewId: 15,
          quote: "A postcard mistaken for a novel.",
          score: 40,
          author: "Bram Selig",
          authorSlug: "bram-selig",
          publicationName: "Cut & Print",
          publicationSlug: "cut-and-print",
          url: "https://example.invalid/cutprint/blue-horizon",
          date: "2011-10-09",
        }),
      ],
    },
  },
};

/**
 * A sample whose quotes are long enough that the rendered listing runs well past
 * the text mirror's budget. This is what a mirror that appends its attribution
 * and truncates afterwards loses first: the credit on someone else's writing.
 *
 * One quote carries blank lines, since third-party prose that sits flush against
 * the server's own lines reads as if the server had written it.
 */
const longQuote = (opening) =>
  [
    opening,
    "The camera stays put while the weather does the acting, and for a while that is enough to carry a scene that has nowhere in particular to go.",
    "",
    "By the second hour the trick has been shown twice too often, though the closing minutes recover more ground than seems possible from where they start.",
  ].join("\n");

const REVIEWS_CRITIC_LONG = {
  data: {
    totalResults: 36,
    item: {
      default: [
        criticReview({
          reviewId: 41,
          quote: longQuote("A film that trusts its silences, and is right to."),
          score: 91,
          author: "Marisol Vane",
          publicationName: "The Harbour Review",
          publicationSlug: "the-harbour-review",
          url: "https://example.invalid/harbour/blue-horizon",
        }),
        criticReview({
          reviewId: 42,
          quote: longQuote("Two hours of weather and grief, beautifully shot."),
          score: 84,
          author: "Ines Kavanagh",
          publicationName: "Northern Screen",
          publicationSlug: "northern-screen",
          url: "https://example.invalid/northern/blue-horizon",
        }),
        criticReview({
          reviewId: 43,
          quote: longQuote("The letters device strains, but the lead does not."),
          score: 70,
          author: "Peter Oduya",
          publicationName: "Reel Quarterly",
          publicationSlug: "reel-quarterly",
          url: "https://example.invalid/reel/blue-horizon",
        }),
        criticReview({
          reviewId: 44,
          quote: longQuote("Handsome and inert in roughly equal measure."),
          score: 58,
          author: "Dana Whitlock",
          publicationName: "The Evening Ledger",
          publicationSlug: "the-evening-ledger",
          url: "https://example.invalid/ledger/blue-horizon",
        }),
        criticReview({
          reviewId: 45,
          quote: longQuote("A postcard mistaken for a novel."),
          score: 40,
          author: "Bram Selig",
          publicationName: "Cut & Print",
          publicationSlug: "cut-and-print",
          // No article link: the entry page has to stand in for it.
          url: null,
        }),
      ],
      positive: [],
      neutral: [],
      negative: [],
    },
  },
};

/**
 * A sample where one entry names no publication. An unattributable quote cannot
 * be handed to a model, so it is dropped rather than shown as anonymous, and
 * the count of what arrived stays what the site sent.
 */
const REVIEWS_CRITIC_NO_PUBLICATION = {
  data: {
    totalResults: 36,
    item: {
      default: [
        criticReview({
          reviewId: 21,
          quote: "Attributable, and therefore quotable.",
          score: 77,
          author: "Marisol Vane",
          publicationName: "The Harbour Review",
          publicationSlug: "the-harbour-review",
          url: "https://example.invalid/harbour/blue-horizon",
        }),
        {
          reviewId: 22,
          quote: "Nobody will admit to having written this one.",
          score: 55,
          author: "Unsigned",
          date: "2011-10-08",
          url: "https://example.invalid/unknown/blue-horizon",
        },
        criticReview({
          reviewId: 23,
          quote: "Also attributable.",
          score: 62,
          author: "Peter Oduya",
          publicationName: "Reel Quarterly",
          publicationSlug: "reel-quarterly",
          url: "https://example.invalid/reel/blue-horizon",
        }),
      ],
      positive: [],
      neutral: [],
      negative: [],
    },
  },
};

const userReview = (over) => ({
  quote: "No quote.",
  score: 5,
  date: "2011-11-01",
  reviewId: 1,
  __noise: { helpfulVotes: 0, spoiler: false },
  ...over,
});

const REVIEWS_USER = {
  data: {
    totalResults: 1204,
    item: {
      default: [
        userReview({
          reviewId: 31,
          quote: "Watched it twice in one night.",
          score: 10,
          date: "2011-11-02",
        }),
        userReview({
          reviewId: 32,
          quote: "The sound design alone is worth it.",
          score: 9,
          date: "2011-11-04",
        }),
        userReview({
          reviewId: 33,
          quote: "Fine, if you like watching rain.",
          score: 6,
          date: "2011-11-09",
        }),
        userReview({
          reviewId: 34,
          quote: "I fell asleep twice and missed nothing.",
          score: 3,
          date: "2011-11-15",
        }),
        userReview({
          reviewId: 35,
          quote: "Overlong, but the ending earns it.",
          score: 8,
          date: "2011-11-21",
        }),
      ],
      positive: [
        userReview({
          reviewId: 31,
          quote: "Watched it twice in one night.",
          score: 10,
          date: "2011-11-02",
        }),
        userReview({
          reviewId: 32,
          quote: "The sound design alone is worth it.",
          score: 9,
          date: "2011-11-04",
        }),
        userReview({
          reviewId: 35,
          quote: "Overlong, but the ending earns it.",
          score: 8,
          date: "2011-11-21",
        }),
      ],
      neutral: [
        userReview({
          reviewId: 33,
          quote: "Fine, if you like watching rain.",
          score: 6,
          date: "2011-11-09",
        }),
      ],
      negative: [
        userReview({
          reviewId: 34,
          quote: "I fell asleep twice and missed nothing.",
          score: 3,
          date: "2011-11-15",
        }),
      ],
    },
  },
};

/**
 * A click-tracking redirect of the size the offers route really serves: several
 * hundred characters of encoded analytics payload, with the only part anyone
 * can use, the destination, buried in the `r` parameter.
 */
const tracker = (destination) => {
  const payload = Buffer.from(
    JSON.stringify({
      schema: "iglu:invalid.example/clickout_context/jsonschema/1-3-2",
      data: {
        provider: "Lantern Video",
        monetizationType: "rent",
        presentationType: "hd",
        currency: "USD",
        price: 3.99,
        partnerId: 1051,
        providerId: 538,
        surface: "web",
        note: "padding that exists so this link is as long as the real thing",
      },
    }),
  ).toString("base64");

  return `https://click.example-tracker.invalid/a?cx=${payload}&r=${encodeURIComponent(destination)}&uct_country=US&sid=mcp`;
};

const OFFERS = {
  data: {
    item: {
      hasOffers: true,
      rent: [
        {
          providerId: 538,
          providerName: "Lantern Video",
          providerIcon: "https://images.example.invalid/icon/301832745/s100",
          link: tracker("https://watch.example.invalid/title"),
          price: "3.99",
          currency: "USD",
        },
        {
          providerId: 612,
          providerName: "Coastline Store",
          // Already a plain destination: nothing to unwrap, nothing to change.
          link: "https://example.invalid/coastline/blue-horizon",
          price: "4.49",
          currency: "USD",
        },
      ],
      free: [],
      buy: [
        {
          providerId: 538,
          providerName: "Lantern Video",
          link: tracker("https://watch.example.invalid/title/buy"),
          price: "12.99",
          currency: "USD",
        },
      ],
      __noise: { updatedAt: "2024-01-01" },
    },
  },
};

/** Failure envelope, served with HTTP 404 by the upstream. */
const ERROR_404 = {
  errors: [
    {
      code: 404,
      reason: "Not Found",
      message: "No entry for that slug.",
      requestId: "00000000-0000-0000-0000-000000000000",
    },
  ],
};

/** Neither `data` nor `errors`: readable JSON that says nothing this client knows. */
const NO_ENVELOPE = {
  result: { ok: true, note: "an envelope this client has never seen" },
};

/** A legitimate empty answer, which must not be reported as a failure. */
const EMPTY_ITEMS = {
  data: { totalResults: 0, itemsPerPage: 10, items: [] },
};

const badRow = (why) => ({ __unreadable: why, someOtherShape: { nested: true } });

/** One row of three is junk: the other two must still come back. */
const PARTIAL_ROWS = {
  data: {
    totalResults: 90,
    items: [
      searchRow({
        id: 2_000_100_001,
        type: "movie",
        title: "Blue Horizon",
        slug: "blue-horizon",
        criticScoreSummary: { score: 81, max: 100 },
      }),
      badRow("no id, type, title or slug"),
      searchRow({
        id: 2_000_100_003,
        type: "game-title",
        typeId: 13,
        title: "Cinder Vale",
        slug: "cinder-vale",
        criticScoreSummary: { score: 88, max: 100 },
      }),
    ],
  },
};

/** Every row is junk: nothing readable came back, which is a failure, not an empty page. */
const UNREADABLE_ROWS = {
  data: {
    totalResults: 90,
    items: [badRow("row one"), badRow("row two"), badRow("row three")],
  },
};

const FIXTURES = {
  "search.json": SEARCH,
  "browse.json": BROWSE,
  "detail-movie.json": DETAIL_MOVIE,
  "detail-game.json": DETAIL_GAME,
  "score-critic.json": SCORE_CRITIC,
  "score-user.json": SCORE_USER,
  "score-no-max.json": SCORE_NO_MAX,
  "reviews-critic.json": REVIEWS_CRITIC,
  "reviews-critic-no-publication.json": REVIEWS_CRITIC_NO_PUBLICATION,
  "reviews-critic-long.json": REVIEWS_CRITIC_LONG,
  "reviews-user.json": REVIEWS_USER,
  "offers.json": OFFERS,
  "error-404.json": ERROR_404,
  "no-envelope.json": NO_ENVELOPE,
  "empty-items.json": EMPTY_ITEMS,
  "partial-rows.json": PARTIAL_ROWS,
  "unreadable-rows.json": UNREADABLE_ROWS,
};

mkdirSync(OUT_DIR, { recursive: true });

for (const [name, value] of Object.entries(FIXTURES)) {
  writeFileSync(join(OUT_DIR, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

// Not JSON at all: the shape a CDN error page or an interstitial arrives in.
writeFileSync(
  join(OUT_DIR, "not-json.txt"),
  [
    "<!DOCTYPE html>",
    "<html><head><title>Just a moment...</title>",
    "<body>Checking your browser.",
    "</html>",
    "",
  ].join("\n"),
  "utf8",
);

process.stdout.write(`wrote ${Object.keys(FIXTURES).length + 1} fixtures to ${OUT_DIR}\n`);
