export default {
  port: process.env.PORT || 3001,
  omdbApiKey: process.env.OMDB_API_KEY || 'b43344b2',
  opensubtitlesApiKey: process.env.OPENSUBTITLES_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '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',
  minImdbRating: 6.0,
  sources: {
    movies123: 'https://ww6.123movieshd.com',
    ytsApi: 'https://yts.torrentbay.st/api/v2'
  }
};
