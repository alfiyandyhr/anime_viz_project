const { test } = require('node:test');
const assert = require('node:assert/strict');
const { movieConnections } = require('../frontend/common/dust-connections.js');
const { rankCorpus } = require('../frontend/common/dust-context.js');

test('each movie ranks its visible 60 dusts locally, independently of table sorting and hidden corpus extremes', () => {
  const data = { movies: [{id:'a'}, {id:'b'}, {id:'c'}],
    anime: Array.from({length:80}, (_, i) => ({id:String(i)})) };
  // Opposite order for the first two movies; stable ties for the third.
  const scores = Float32Array.from([
    ...Array.from({length:80}, (_, i) => i / 80 - .5),
    ...Array.from({length:80}, (_, i) => .5 - i / 80),
    ...Array.from({length:80}, () => -.1)
  ]);
  const expected = [
    [69,68,67,66,65,14,13,12,11,10],
    [10,11,12,13,14,65,66,67,68,69],
    [10,11,12,13,14,65,66,67,68,69]
  ];
  for (let count = 1; count <= 3; count++) {
    const movieIds = data.movies.slice(0,count).map(movie => movie.id);
    for (const sort of [...movieIds, 'average']) {
      const ranking = rankCorpus(data,scores,movieIds,sort);
      const displayedDust = ranking.filter(row => row.index >= 10 && row.index < 70)
        .map(row => ({...row, closest:row.scores.indexOf(Math.max(...row.scores))}));
      const snapshot = {movieIds, displayedDust, ranking};
      const before = JSON.stringify(snapshot);
      const groups = movieConnections(snapshot);
      assert.equal(groups.length,count);
      groups.forEach((group, movieIndex) => {
        assert.equal(group.total,60);
        assert.equal(group.omitted,50);
        assert.deepEqual(group.matches.map(row => row.anime.id), expected[movieIndex].map(String));
        assert.deepEqual(group.matches.map(row => row.rank), [1,2,3,4,5,56,57,58,59,60]);
        assert.deepEqual(group.matches.map(row => row.group), [...Array(5).fill('top'), ...Array(5).fill('bottom')]);
        group.matches.forEach(row => {
          assert.equal(row.similarity,scores[movieIndex * 80 + Number(row.anime.id)]);
          assert.equal(row.closest,displayedDust.find(dust => dust.anime.id === row.anime.id).closest);
        });
      });
      assert.equal(JSON.stringify(snapshot),before);
    }
  }
});

test('empty and filtered dust sets never duplicate titles between top and bottom groups', () => {
  assert.deepEqual(movieConnections({movieIds:[],displayedDust:[]}),[]);
  for (let count = 0; count <= 10; count++) {
    const displayedDust = Array.from({length:count}, (_, i) => ({anime:{id:String(i)},index:i,scores:[-i],closest:0}));
    const [group] = movieConnections({movieIds:['a'],displayedDust});
    assert.equal(group.total,count);
    assert.equal(group.matches.length,count);
    assert.equal(new Set(group.matches.map(row => row.anime.id)).size,count);
    assert.equal(group.omitted,0);
    assert.deepEqual(group.matches.map(row => row.rank),Array.from({length:count}, (_, i) => i+1));
  }
});

test('changing displayed membership reranks each movie without retaining global ranks', () => {
  const displayedDust = Array.from({length:90}, (_, i) => ({anime:{id:String(i)},index:i,
    scores:[i,90-i,45],closest:i>45?0:1,rank:1000-i}));
  for (const count of [30,60,90,13,1,0]) {
    const visible = displayedDust.slice(0,count);
    const groups = movieConnections({movieIds:['a','b','c'],displayedDust:visible});
    for (const group of groups) {
      assert.equal(group.total,count);
      assert.ok(group.matches.every(row => visible.some(dust => dust.anime.id === row.anime.id)));
      assert.equal(group.matches[0]?.rank,count ? 1 : undefined);
      assert.equal(group.matches.at(-1)?.rank,count || undefined);
    }
  }
});
