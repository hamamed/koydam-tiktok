/** Ready-made team sets for the Teams page. Countries use picture flags (web/lib/flags.js). */
import { countryTeam } from './flags';

import { ONE_COIN_FALLBACK } from './gifts';
// 1-coin gifts only, one per country; countries after them join by chat (the Teams page fills more from the real catalog).
const countries = (codes) => ({ category: 'الدول', teams: codes.map((c, i) => countryTeam(c, ONE_COIN_FALLBACK[i])) });

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
