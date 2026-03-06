export default {
  port: process.env.PORT || 3001,
  omdbApiKey: process.env.OMDB_API_KEY || 'b43344b2',
  minImdbRating: 6.0,
  sources: {
    movies123: 'https://ww6.123movieshd.com',
    ytsApi: 'https://yts.torrentbay.st/api/v2'
  }
};
