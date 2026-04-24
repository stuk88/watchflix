import axios from 'axios';
import config from '../config.js';

const cache = new Map();

export async function fetchRatings(title, year) {
  const key = `${title}::${year || ''}`;
  if (cache.has(key)) return cache.get(key);

  try {
    const params = { t: title, apikey: config.omdbApiKey };
    if (year) params.y = year;
    const { data } = await axios.get('https://www.omdbapi.com/', { params, timeout: 10000 });

    if (data.Response === 'False') {
      cache.set(key, null);
      return null;
    }

    const result = {
      title: data.Title,
      year: parseInt(data.Year) || null,
      imdb_id: data.imdbID,
      imdb_rating: data.imdbRating !== 'N/A' ? parseFloat(data.imdbRating) : null,
      rt_rating: null,
      meta_rating: data.Metascore !== 'N/A' ? parseInt(data.Metascore) : null,
      poster: data.Poster !== 'N/A' ? data.Poster : null,
      plot: data.Plot !== 'N/A' ? data.Plot : null,
      genre: data.Genre !== 'N/A' ? data.Genre : null,
      runtime: data.Runtime !== 'N/A' ? data.Runtime : null,
      director: data.Director !== 'N/A' ? data.Director : null,
      actors: data.Actors !== 'N/A' ? data.Actors : null,
      country: data.Country !== 'N/A' ? data.Country : null,
    };

    if (data.Ratings) {
      const rt = data.Ratings.find(r => r.Source === 'Rotten Tomatoes');
      if (rt) result.rt_rating = rt.Value;
    }

    cache.set(key, result);
    return result;
  } catch (err) {
    console.error(`[OMDb] Error fetching "${title}":`, err.message);
    return null;
  }
}
