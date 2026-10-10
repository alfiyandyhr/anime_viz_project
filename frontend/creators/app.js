"use strict";

Object.assign(elements, {
  networkSearch: document.querySelector("#network-search"),
  networkTypeButtons: document.querySelectorAll("[data-network-type]"),
  networkSummary: document.querySelector("#network-summary")
});

function renderStudioChart() {
  const container = document.querySelector("#studio-chart");
  clearChart(container);

  const data = computeStudioStats(state.filteredAnime)
    .filter((item) => Number.isFinite(item.averageScore))
    .sort((a, b) => d3.descending(
      a.totalPopularity,
      b.totalPopularity
    ))
    .slice(0, 15);

  if (!data.length) {
    renderEmpty(container, "No studio score data match the filters.");
    return;
  }

  const width = Math.max(container.clientWidth, 320);
  const height = Math.max(container.clientHeight, 480);
  const margin = { top: 15, right: 35, bottom: 50, left: 120 };

  const svg = d3.select(container)
    .append("svg")
    .attr("viewBox", [0, 0, width, height]);

  const scoreExtent = d3.extent(data, (item) => item.averageScore);

  const x = d3.scaleLinear()
    .domain([
      Math.max(0, scoreExtent[0] - 5),
      Math.min(100, scoreExtent[1] + 4)
    ])
    .nice()
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(data.map((item) => item.studio))
    .range([margin.top, height - margin.bottom])
    .padding(0.3);

  const radius = d3.scaleSqrt()
    .domain([1, d3.max(data, (item) => item.count) || 1])
    .range([4, 12]);

  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(
      d3.axisBottom(x)
        .ticks(5)
        .tickSize(-(height - margin.top - margin.bottom))
        .tickFormat("")
    );

  svg.append("g")
    .selectAll("line")
    .data(data)
    .join("line")
    .attr("x1", x.range()[0])
    .attr("x2", (item) => x(item.averageScore))
    .attr("y1", (item) => y(item.studio) + y.bandwidth() / 2)
    .attr("y2", (item) => y(item.studio) + y.bandwidth() / 2)
    .attr("stroke", "rgba(255,255,255,0.16)")
    .attr("stroke-width", 2);

  svg.append("g")
    .selectAll("circle")
    .data(data)
    .join("circle")
    .attr("cx", (item) => x(item.averageScore))
    .attr("cy", (item) => y(item.studio) + y.bandwidth() / 2)
    .attr("r", (item) => radius(item.count))
    .attr("fill", (item) => state.genreColor(item.dominantGenre))
    .attr("stroke", "white")
    .attr("stroke-width", 1)
    .style("cursor", "pointer")
    .on("mouseenter", (event, item) => {
      showTooltip(event, `
        <strong>${escapeHTML(item.studio)}</strong>
        <span>
          Titles: ${item.count}<br>
          Average score: ${item.averageScore.toFixed(1)}<br>
          Popularity: ${formatNumber(item.totalPopularity)}<br>
          Dominant genre: ${escapeHTML(item.dominantGenre)}
        </span>
      `);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave", hideTooltip)
    .on("click", (_, item) => {
      hideTooltip();
      elements.studioFilter.value = item.studio;
      applyFilters();
    });

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(5));

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(
      d3.axisLeft(y)
        .tickFormat((value) => truncate(value, 18))
        .tickSize(0)
    )
    .call((group) => group.select(".domain").remove());

  svg.append("text")
    .attr("class", "axis-label")
    .attr("x", (margin.left + width - margin.right) / 2)
    .attr("y", height - 12)
    .attr("text-anchor", "middle")
    .text("Average audience score / 100");
}

function renderHeatmap() {
  const container = document.querySelector("#heatmap-chart");
  clearChart(container);

  const anime = state.filteredAnime;

  if (!anime.length) {
    renderEmpty(container, "No studio–genre data match the filters.");
    return;
  }

  const topStudios = computeStudioStats(anime)
    .sort((a, b) => d3.descending(a.count, b.count))
    .slice(0, 11)
    .map((item) => item.studio);

  const topGenres = computeGenreStats(anime)
    .sort((a, b) => d3.descending(a.count, b.count))
    .slice(0, 10)
    .map((item) => item.genre);

  const cells = [];

  topStudios.forEach((studio) => {
    topGenres.forEach((genre) => {
      const matchingAnime = anime.filter((item) => (
        item.studio_names.includes(studio)
        && item.genres.includes(genre)
      ));

      cells.push({
        studio,
        genre,
        count: matchingAnime.length,
        titles: matchingAnime.map((item) => item.title)
      });
    });
  });

  const width = Math.max(container.clientWidth, 850);
  const height = Math.max(container.clientHeight, 540);
  const margin = { top: 135, right: 25, bottom: 35, left: 130 };

  const svg = d3.select(container)
    .append("svg")
    .attr("viewBox", [0, 0, width, height]);

  const x = d3.scaleBand()
    .domain(topGenres)
    .range([margin.left, width - margin.right])
    .padding(0.08);

  const y = d3.scaleBand()
    .domain(topStudios)
    .range([margin.top, height - margin.bottom])
    .padding(0.08);

  const color = d3.scaleSequential()
    .domain([0, d3.max(cells, (item) => item.count) || 1])
    .interpolator(d3.interpolatePurples);

  svg.append("g")
    .selectAll("rect")
    .data(cells)
    .join("rect")
    .attr("x", (item) => x(item.genre))
    .attr("y", (item) => y(item.studio))
    .attr("width", x.bandwidth())
    .attr("height", y.bandwidth())
    .attr("rx", 5)
    .attr("fill", (item) => (
      item.count === 0
        ? "rgba(255,255,255,0.025)"
        : color(item.count)
    ))
    .attr("stroke", "rgba(255,255,255,0.055)")
    .style("cursor", (item) => item.count ? "pointer" : "default")
    .on("mouseenter", (event, item) => {
      showTooltip(event, `
        <strong>
          ${escapeHTML(item.studio)} × ${escapeHTML(item.genre)}
        </strong>
        <span>
          ${item.count} matching title${item.count === 1 ? "" : "s"}<br>
          ${escapeHTML(item.titles.slice(0, 4).join(", ") || "No titles")}
        </span>
      `);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave", hideTooltip)
    .on("click", (_, item) => {
      if (!item.count) {
        return;
      }

      elements.genreFilter.value = item.genre;
      elements.studioFilter.value = item.studio;
      applyFilters();
    });

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${margin.top})`)
    .call(d3.axisTop(x).tickSize(0))
    .call((group) => group.select(".domain").remove())
    .selectAll("text")
    .attr("transform", "rotate(-38)")
    .attr("text-anchor", "start")
    .attr("dx", "0.5em")
    .attr("dy", "-0.25em");

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(
      d3.axisLeft(y)
        .tickFormat((value) => truncate(value, 22))
        .tickSize(0)
    )
    .call((group) => group.select(".domain").remove());
}

const NETWORK_TYPES = {
  actor: { label: "Voice actor", color: "#9d7bff" },
  character: { label: "Character", color: "#ff6fae" },
  work: { label: "Work (anime)", color: "#43d9e6" }
};

function buildCollaborationNetwork(anime, selectedTypes, search = "", workLimit = 35) {
  const query = search.trim().toLowerCase();
  const matchingWorks = anime.filter((work) => {
    const names = [
      work.title,
      ...Object.values(work.titles || {}),
      ...(work.voice_actors || []).flatMap((actor) => [
        actor.name,
        ...(actor.characters || [])
      ])
    ];
    return !query || names.some((name) => (
      name && name.toLowerCase().includes(query)
    ));
  }).sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  const works = matchingWorks.slice(0, workLimit);
  const nodeMap = new Map();
  const linkMap = new Map();

  function addNode(id, name, type, work) {
    if (!nodeMap.has(id)) {
      nodeMap.set(id, { id, name, type, works: new Map() });
    }
    nodeMap.get(id).works.set(work.id, work);
  }

  function addLink(source, target, relation, work) {
    // Treat links as undirected, including actors recurring across works.
    [source, target] = [source, target].sort();
    const id = `${source}|${target}`;
    if (!linkMap.has(id)) {
      linkMap.set(id, { source, target, relation, works: new Map() });
    }
    linkMap.get(id).works.set(work.id, work);
  }

  function connectPeers(ids, relation, work) {
    const peers = [...ids];
    peers.forEach((source, index) => {
      peers.slice(index + 1).forEach((target) => {
        addLink(source, target, relation, work);
      });
    });
  }

  works.forEach((work) => {
    const workId = `work:${work.id}`;
    const actorIds = new Set();
    const characterIds = new Set();
    addNode(workId, work.title, "work", work);

    (work.voice_actors || []).forEach((actor) => {
      const actorId = `actor:${actor.id}`;
      actorIds.add(actorId);
      addNode(actorId, actor.name, "actor", work);
      addLink(actorId, workId, "Appears in", work);

      (actor.characters || []).forEach((character) => {
        // The bundled data contains character names, not AniList character IDs.
        // Scope roles to their work so unrelated characters with the same name
        // cannot be accidentally merged.
        const characterId = `character:${work.id}:${character}`;
        characterIds.add(characterId);
        addNode(characterId, character, "character", work);
        addLink(actorId, characterId, "Voices", work);
        addLink(workId, characterId, "Features", work);
      });
    });
    connectPeers(actorIds, "Co-stars in", work);
    connectPeers(characterIds, "Appears together in", work);
  });

  const nodes = [...nodeMap.values()]
    .filter((node) => selectedTypes.has(node.type))
    .map((node) => ({ ...node, works: [...node.works.values()] }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = [...linkMap.values()]
    .filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target))
    .map((link) => ({ ...link, works: [...link.works.values()] }));
  const neighbors = new Map(nodes.map((node) => [node.id, new Set()]));
  links.forEach((link) => {
    neighbors.get(link.source).add(link.target);
    neighbors.get(link.target).add(link.source);
  });
  nodes.forEach((node) => {
    node.degree = neighbors.get(node.id).size;
  });
  const minDegree = Math.min(...nodes.map((node) => node.degree));
  const maxDegree = Math.max(0, ...nodes.map((node) => node.degree));
  nodes.forEach((node) => {
    // More distinct neighbors means higher opacity (less transparency).
    node.opacity = maxDegree === minDegree
      ? (maxDegree > 0 ? 1 : 0.3)
      : 0.3 + 0.7 * ((node.degree - minDegree) / (maxDegree - minDegree));
  });

  return {
    nodes,
    links,
    sampledWorkCount: works.length,
    matchingWorkCount: matchingWorks.length
  };
}

function renderNetwork() {
  const container = document.querySelector("#network-chart");

  if (!state.data) {
    return;
  }

  if (state.networkSimulation) {
    state.networkSimulation.stop();
    state.networkSimulation = null;
  }

  hideTooltip();
  clearChart(container);

  const { nodes, links, sampledWorkCount, matchingWorkCount } =
    buildCollaborationNetwork(
      state.filteredAnime,
      state.networkTypes,
      elements.networkSearch.value
    );
  const counts = d3.rollup(nodes, (items) => items.length, (node) => node.type);
  elements.networkSummary.textContent =
    `${counts.get("actor") || 0} voice actors · `
    + `${counts.get("character") || 0} characters · `
    + `${counts.get("work") || 0} works · ${links.length} connections. `
    + `Showing ${sampledWorkCount} of ${matchingWorkCount} matching works`
    + (sampledWorkCount < matchingWorkCount ? " with the highest popularity." : ".")
    + " More connections = less transparency.";

  if (!nodes.length) {
    renderEmpty(container, state.networkTypes.size
      ? "No actors, characters, or works match these filters."
      : "Select a node type above to show the network.");
    return;
  }

  const width = Math.max(container.clientWidth, 320);
  const height = Math.max(container.clientHeight, 560);
  const maxDegree = d3.max(nodes, (node) => node.degree) || 1;
  const radius = d3.scaleSqrt().domain([0, maxDegree]).range([5, 20]);

  const svg = d3.select(container)
    .append("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("role", "img")
    .attr("aria-label", "Network connecting voice actors, characters, and anime works");
  svg.append("title").text("Voice actors, characters, and works");
  const root = svg.append("g");

  let fitOnEnd = true;
  const zoom = d3.zoom()
    .scaleExtent([0.2, 4])
    .on("zoom", (event) => {
      if (event.sourceEvent) {
        fitOnEnd = false;
      }
      root.attr("transform", event.transform);
    });
  svg.call(zoom);

  const link = root.append("g")
    .attr("class", "network-links")
    .attr("stroke", "rgba(170,179,207,0.28)")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("stroke", (item) => (
      item.relation === "Co-stars in" ? "rgba(157,123,255,0.24)"
        : item.relation === "Appears together in" ? "rgba(255,111,174,0.16)"
          : "rgba(170,179,207,0.28)"
    ))
    .attr("stroke-width", (item) => 1 + Math.min(item.works.length - 1, 4) * 0.5)
    .on("mouseenter", (event, item) => {
      showTooltip(event, `
        <strong>${escapeHTML(item.relation)}</strong>
        <span>
          ${escapeHTML(item.source.name)} ↔ ${escapeHTML(item.target.name)}<br>
          ${item.works.length} shared anime work${item.works.length === 1 ? "" : "s"}<br>
          ${escapeHTML(item.works.slice(0, 5).map((work) => work.title).join(", "))}
        </span>
      `);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave", hideTooltip);

  const labelVisible = (item) => nodes.length <= 50 || item.type === "work"
    || (item.type === "actor" && item.degree >= Math.max(4, maxDegree * 0.4));
  const node = root.append("g")
    .attr("class", "network-nodes")
    .selectAll("g")
    .data(nodes, (item) => item.id)
    .join("g")
    .attr("data-node-type", (item) => item.type)
    .style("cursor", "grab")
    .on("mouseenter", function (event, item) {
      d3.select(this).select("circle").attr("stroke-width", 3);
      d3.select(this).select("text").attr("visibility", "visible");
      showTooltip(event, `
        <strong>${escapeHTML(item.name)}</strong>
        <span>
          ${NETWORK_TYPES[item.type].label}<br>
          Connections in view: ${item.degree}<br>
          Anime works: ${item.works.length}<br>
          ${escapeHTML(item.works.slice(0, 5).map((work) => work.title).join(", "))}
        </span>
      `);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave", function (_, item) {
      d3.select(this).select("circle").attr("stroke-width", 1.3);
      d3.select(this).select("text")
        .attr("visibility", labelVisible(item) ? "visible" : "hidden");
      hideTooltip();
    })
    .on("click", (_, item) => {
      hideTooltip();
      if (item.type === "actor") {
        openVoiceActorDetail(item);
      } else {
        openAnimeDetail(item.works[0]);
      }
    });

  node.append("circle")
    .attr("r", (item) => radius(item.degree))
    .attr("fill", (item) => NETWORK_TYPES[item.type].color)
    .attr("opacity", (item) => item.opacity)
    .attr("stroke", "rgba(255,255,255,0.72)")
    .attr("stroke-width", 1.3);

  node.append("text")
    .attr("x", (item) => radius(item.degree) + 5)
    .attr("y", 3)
    .attr("fill", "#dce2f8")
    .attr("visibility", (item) => labelVisible(item) ? "visible" : "hidden")
    .attr("font-size", 9)
    .attr("pointer-events", "none")
    .attr("paint-order", "stroke")
    .attr("stroke", "#0b1020")
    .attr("stroke-width", 3)
    .text((item) => truncate(item.name, 23));

  const simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links)
      .id((item) => item.id)
      .distance(65)
      .strength(0.45))
    .force("charge", d3.forceManyBody().strength(-65))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide()
      .radius((item) => radius(item.degree) + 5))
    .force("x", d3.forceX(width / 2).strength(0.07))
    .force("y", d3.forceY(height / 2).strength(0.07))
    .on("tick", () => {
      link
        .attr("x1", (item) => item.source.x)
        .attr("y1", (item) => item.source.y)
        .attr("x2", (item) => item.target.x)
        .attr("y2", (item) => item.target.y);
      node.attr("transform", (item) => `translate(${item.x},${item.y})`);
    });
  state.networkSimulation = simulation;

  // Fit the settled layout to the viewport, including narrow screens.
  simulation.on("end", () => {
    if (!fitOnEnd) {
      return;
    }
    fitOnEnd = false;
    const bounds = root.node().getBBox();
    const scale = Math.min(1, (width - 40) / bounds.width, (height - 40) / bounds.height);
    if (Number.isFinite(scale) && scale > 0) {
      svg.call(zoom.transform, d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-bounds.x - bounds.width / 2, -bounds.y - bounds.height / 2));
    }
  });

  node.call(
    d3.drag()
      .on("start", (event, item) => {
        fitOnEnd = false;
        if (!event.active) {
          simulation.alphaTarget(0.25).restart();
        }
        item.fx = item.x;
        item.fy = item.y;
      })
      .on("drag", (event, item) => {
        item.fx = event.x;
        item.fy = event.y;
      })
      .on("end", (event, item) => {
        if (!event.active) {
          simulation.alphaTarget(0);
        }
        item.fx = null;
        item.fy = null;
      })
  );
}

function buildVoiceActorProfile(actorId, anime) {
  let actor = null;
  const credits = [];
  anime.forEach((work) => {
    const cast = (work.voice_actors || [])
      .filter((item) => String(item.id) === String(actorId));
    if (!cast.length) {
      return;
    }
    actor = actor || cast[0];
    credits.push({
      work,
      characters: [...new Set(cast.flatMap((item) => item.characters || []))]
    });
  });
  if (!actor) {
    return null;
  }
  credits.sort((a, b) => (b.work.popularity || 0) - (a.work.popularity || 0));
  return {
    ...actor,
    credits,
    roleCount: credits.reduce((count, credit) => count + credit.characters.length, 0)
  };
}

function openVoiceActorDetail(node) {
  const profile = buildVoiceActorProfile(node.id.slice("actor:".length), state.data.anime);
  if (!profile) {
    return;
  }
  const initials = profile.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("");
  elements.drawerContent.innerHTML = `
    <div class="actor-profile">
      <div class="actor-profile-header">
        ${profile.image ? `
          <img class="actor-portrait"
            src="${escapeAttribute(profile.image)}"
            alt="Portrait of ${escapeAttribute(profile.name)}">
        ` : `
          <div class="actor-portrait actor-portrait-placeholder" aria-hidden="true">
            ${escapeHTML(initials)}
          </div>
        `}
        <div>
          <p class="chart-kicker">Japanese voice actor</p>
          <h2>${escapeHTML(profile.name)}</h2>
        </div>
      </div>

      <div class="detail-stats">
        <div class="detail-stat">
          <span>Sampled works</span><strong>${profile.credits.length}</strong>
        </div>
        <div class="detail-stat">
          <span>Main-role credits</span><strong>${profile.roleCount}</strong>
        </div>
        <div class="detail-stat">
          <span>Connections in view</span><strong>${node.degree}</strong>
        </div>
      </div>

      ${profile.site_url ? `
        <a class="button button-primary"
          href="${escapeAttribute(profile.site_url)}"
          target="_blank" rel="noopener noreferrer">View profile on AniList</a>
      ` : ""}

      <section class="detail-section">
        <h3>Filmography &amp; characters</h3>
        <p class="actor-profile-note">
          Japanese main roles across the loaded anime sample.
          Select a work to view its details.
        </p>
        <div class="actor-filmography">
          ${profile.credits.map(({ work, characters }) => `
            <button type="button" class="actor-credit"
              data-profile-work-id="${escapeAttribute(work.id)}">
              <strong>${escapeHTML(work.title)}</strong>
              <small>${escapeHTML(characters.join(", ") || "Character unavailable")}</small>
              <span>${work.year || "Unknown year"} · ${escapeHTML(humanize(work.format))}</span>
            </button>
          `).join("")}
        </div>
      </section>
    </div>
  `;
  elements.drawerContent.querySelectorAll("[data-profile-work-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const credit = profile.credits.find(({ work }) => (
        String(work.id) === button.dataset.profileWorkId
      ));
      openAnimeDetail(credit.work);
    });
  });
  openDrawer();
}

registerPage({
  bindControls() {
    elements.networkSearch.addEventListener("input", debounce(renderNetwork, 200));
    elements.networkTypeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const type = button.dataset.networkType;
        if (state.networkTypes.has(type)) {
          state.networkTypes.delete(type);
        } else {
          state.networkTypes.add(type);
        }
        button.setAttribute("aria-pressed", state.networkTypes.has(type));
        renderNetwork();
      });
    });
  },
  resetControls() {
    elements.networkSearch.value = "";
    state.networkTypes = new Set(["actor", "character", "work"]);
    elements.networkTypeButtons.forEach((button) => {
      button.setAttribute("aria-pressed", "true");
    });
  },
  render() {
    renderStudioChart();
    renderHeatmap();
    renderNetwork();
  }
});
