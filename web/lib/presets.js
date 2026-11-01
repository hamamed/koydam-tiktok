/** Ready-made team sets for the Teams page. Countries use picture flags (web/lib/flags.js). */
import { countryTeam } from './flags';

// 22 different, common gifts so each country gets its own gift.
const GIFTS = ['Rose', 'TikTok', 'Finger Heart', 'Ice Cream Cone', 'GG', 'Heart Me', 'Hand Hearts', 'Perfume', 'Doughnut', 'Cap',
  'Sunglasses', 'Corgi', 'Money Gun', 'Weights', 'Friendship Necklace', 'Love you', 'Cake Slice', 'Hat and Mustache', 'Mic', 'Swan', 'Galaxy', 'Lion'];
const countries = (codes) => ({ category: 'الدول', teams: codes.map((c, i) => countryTeam(c, GIFTS[i % GIFTS.length])) });

export const PRESETS = {
  'كل الدول العربية (22)': countries(['sa', 'eg', 'ma', 'dz', 'tn', 'ly', 'mr', 'sd', 'ae', 'kw', 'qa', 'bh', 'om', 'ye', 'iq', 'sy', 'jo', 'lb', 'ps', 'so', 'dj', 'km']),
  'دول المغرب العربي': countries(['ma', 'dz', 'tn', 'ly', 'mr']),
  'دول الخليج': countries(['sa', 'ae', 'kw', 'qa', 'bh', 'om']),
  'دول المشرق': countries(['iq', 'sy', 'jo', 'lb', 'ps']),
  'وادي النيل والقرن الأفريقي': countries(['eg', 'sd', 'so', 'dj', 'km', 'ye']),
  'الأندية': {
    category: 'الأندية',
    teams: [
      { name: 'الرجاء', emoji: '', color: '#0f9d58', keywords: ['raja', 'rca', 'الرجاء'], gifts: ['Rose'] },
      { name: 'الوداد', emoji: '', color: '#d32f2f', keywords: ['wydad', 'wac', 'الوداد'], gifts: ['TikTok'] },
      { name: 'ريال مدريد', emoji: '', color: '#c9b037', keywords: ['real', 'madrid', 'ريال'], gifts: ['Finger Heart'] },
      { name: 'برشلونة', emoji: '', color: '#1e3a8a', keywords: ['barca', 'barcelona', 'برشلونة', 'برشا'], gifts: ['Ice Cream Cone'] },
    ],
  },
  'القبائل': {
    category: 'القبائل',
    teams: [
      { name: 'القبيلة 1', emoji: '', color: '#b45309', keywords: ['q1'], gifts: ['Rose'] },
      { name: 'القبيلة 2', emoji: '', color: '#0e7490', keywords: ['q2'], gifts: ['TikTok'] },
      { name: 'القبيلة 3', emoji: '', color: '#7c3aed', keywords: ['q3'], gifts: ['Finger Heart'] },
      { name: 'القبيلة 4', emoji: '', color: '#be123c', keywords: ['q4'], gifts: ['Ice Cream Cone'] },
    ],
  },
};
