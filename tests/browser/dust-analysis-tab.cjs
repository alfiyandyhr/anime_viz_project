const tabFor = {
  connections: 'similarities',
  ranking: 'ranking',
  reception: 'reception',
  genres: 'content',
  years: 'content',
  studios: 'credits',
  heatmap: 'credits'
};

async function openAnalysisTab(page, chart) {
  const tab = page.locator(`#dust-tab-${tabFor[chart]}`);
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
}

module.exports = { openAnalysisTab };
