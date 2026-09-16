/* =========================================================================
   Pokemon Data Explorer - front end
   Vanilla JS. Talks to the Flask API, renders the gallery, modal and charts.
   ========================================================================= */

(() => {
  "use strict";

  /* ---------------------------------------------------------------- config */

  const ART_BASE =
    "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";

  // Matches the type colours in style.css so badges, cards and charts agree.
  const TYPE_COLORS = {
    normal: "#9fa19f", fire: "#f97316", water: "#38bdf8", electric: "#ffcb05",
    grass: "#4caf50", ice: "#67e8f9", fighting: "#d64f4f", poison: "#a855f7",
    ground: "#d8a25e", flying: "#93b6ec", psychic: "#ec4899", bug: "#8cb020",
    rock: "#b8a038", ghost: "#7e5fcf", dragon: "#6366f1", dark: "#6b5a4c",
    steel: "#94a3b8", fairy: "#f9a8d4", unknown: "#64748b",
  };

  const TYPE_ICONS = {
    normal: "◍", fire: "🔥", water: "💧", electric: "⚡", grass: "🌿", ice: "❄️",
    fighting: "🥊", poison: "☠️", ground: "🏜️", flying: "🕊️", psychic: "🧠",
    bug: "🐛", rock: "🪨", ghost: "👻", dragon: "🐉", dark: "🌑", steel: "⚙️",
    fairy: "✨",
  };

  const STAT_META = [
    ["hp", "HP", "var(--stat-hp)"],
    ["attack", "Attack", "var(--stat-attack)"],
    ["defense", "Defense", "var(--stat-defense)"],
    ["special_attack", "Sp. Attack", "var(--stat-special_attack)"],
    ["special_defense", "Sp. Defense", "var(--stat-special_defense)"],
    ["speed", "Speed", "var(--stat-speed)"],
  ];

  // Highest total in the dataset, used to scale the small card bars.
  const MAX_TOTAL = 1125;
  const PER_PAGE = 24;

  /* ----------------------------------------------------------------- state */

  const state = {
    page: 1,
    filters: { search: "", type: "", generation: "", battle_style: "", special_status: "", size_class: "", sort: "id" },
    index: [],
    summary: null,
    randomPokemon: null,
    charts: {},
    modalData: null,
    moveFilter: "all",
    lastFocus: null,
  };

  /* --------------------------------------------------------------- helpers */

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  };

  /** Escape user/dataset text before it goes near innerHTML. */
  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  const pad = (id) => String(id).padStart(id >= 10000 ? 5 : 4, "0");
  const num = (value) => (value === null || value === undefined ? "—" : Number(value).toLocaleString());
  const typeColor = (type) => TYPE_COLORS[type] || TYPE_COLORS.unknown;

  function debounce(fn, wait) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  function toast(message) {
    const node = $("toast");
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(node._timer);
    node._timer = setTimeout(() => node.classList.remove("show"), 2600);
  }

  /** GET a JSON endpoint and unwrap the {success, data} envelope. */
  async function api(path) {
    const response = await fetch(path, { headers: { Accept: "application/json" } });
    let body = null;
    try {
      body = await response.json();
    } catch {
      throw new Error("The server sent a response we could not read.");
    }
    if (!response.ok || !body.success) {
      throw new Error(body?.error || "The server could not complete that request.");
    }
    return body;
  }

  /* ------------------------------------------------------------- artwork */

  // Pokeball silhouette shown whenever remote artwork is unavailable.
  const FALLBACK_ART =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="44" fill="#141d3a" stroke="#3b4a7a" stroke-width="3"/>
        <path d="M6 50h88" stroke="#3b4a7a" stroke-width="4"/>
        <circle cx="50" cy="50" r="13" fill="#0b1024" stroke="#3b4a7a" stroke-width="4"/>
        <text x="50" y="86" font-size="9" fill="#6b7aa3" text-anchor="middle"
          font-family="sans-serif">no artwork</text>
      </svg>`
    );

  const artUrl = (id) => `${ART_BASE}/other/official-artwork/${id}.png`;
  const spriteUrl = (id) => `${ART_BASE}/${id}.png`;

  /**
   * Official artwork first, then the small sprite, then the local silhouette.
   * Never leaves a broken image icon on screen.
   */
  function attachArt(img, id, { lazy = true } = {}) {
    img.dataset.stage = "0";
    if (lazy) img.loading = "lazy";
    img.decoding = "async";
    img.onerror = () => {
      const stage = Number(img.dataset.stage);
      if (stage === 0) {
        img.dataset.stage = "1";
        img.src = spriteUrl(id);
      } else if (stage === 1) {
        img.dataset.stage = "2";
        img.src = FALLBACK_ART;
      } else {
        img.onerror = null;
      }
    };
    img.src = artUrl(id);
  }

  /* ------------------------------------------------------------- fragments */

  function typeBadges(types) {
    if (!types || !types.length) return `<span class="badge t-unknown">Unknown</span>`;
    return types
      .map((type) => {
        const icon = TYPE_ICONS[type] ? `${TYPE_ICONS[type]} ` : "";
        return `<span class="badge t-${esc(type)}">${icon}${esc(type)}</span>`;
      })
      .join("");
  }

  /* ========================================================================
     Background orbs
     ===================================================================== */

  function buildOrbs() {
    const layer = $("orbs");
    const count = window.innerWidth < 720 ? 5 : 9;
    for (let i = 0; i < count; i += 1) {
      const orb = el("div", "orb");
      const size = 28 + Math.random() * 80;
      orb.style.width = `${size}px`;
      orb.style.height = `${size}px`;
      orb.style.left = `${Math.random() * 96}%`;
      orb.style.animationDuration = `${26 + Math.random() * 34}s`;
      orb.style.animationDelay = `${-Math.random() * 40}s`;
      orb.style.opacity = 0.25 + Math.random() * 0.35;
      layer.appendChild(orb);
    }
  }

  /* ========================================================================
     Overview cards + hero numbers
     ===================================================================== */

  function countUp(node, target) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      node.textContent = num(target);
      return;
    }
    const duration = 900;
    const start = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = num(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderSummary(summary) {
    const counts = summary.counts;

    const heroValues = [counts.pokemon, counts.species, counts.moves, counts.generations];
    $("heroMeta").querySelectorAll("span").forEach((node, i) => countUp(node, heroValues[i]));

    const cards = [
      { icon: "⚡", value: counts.pokemon, label: "Pokémon", sub: `${num(counts.default_pokemon)} default + ${num(counts.alternate_forms)} forms`, color: "var(--yellow)" },
      { icon: "🧬", value: counts.species, label: "Species", sub: `across ${counts.generations} generations`, color: "var(--grass)" },
      { icon: "🔥", value: counts.types, label: "Types", sub: "used for every badge and chart", color: "var(--fire)" },
      { icon: "🌀", value: counts.abilities, label: "Abilities", sub: "including hidden abilities", color: "var(--violet)" },
      { icon: "💫", value: counts.moves, label: "Moves", sub: `${num(counts.move_links)} learn records`, color: "var(--water)" },
      { icon: "🌟", value: counts.legendary + counts.mythical, label: "Legendary & mythical", sub: `${counts.legendary} legendary, ${counts.mythical} mythical`, color: "var(--red)" },
    ];

    const grid = $("statGrid");
    grid.innerHTML = "";
    cards.forEach((card) => {
      const node = el("div", "stat-card");
      node.style.setProperty("--accent", card.color);
      node.innerHTML = `
        <div class="stat-ico">${card.icon}</div>
        <div class="stat-num">0</div>
        <div class="stat-label">${esc(card.label)}</div>
        <div class="stat-sub">${esc(card.sub)}</div>`;
      node._value = card.value;
      grid.appendChild(node);
    });

    // Animate each card in as it enters the viewport.
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry, i) => {
        if (!entry.isIntersecting) return;
        const node = entry.target;
        setTimeout(() => {
          node.classList.add("in");
          countUp(node.querySelector(".stat-num"), node._value);
        }, i * 70);
        obs.unobserve(node);
      });
    }, { threshold: 0.25 });

    grid.querySelectorAll(".stat-card").forEach((node) => observer.observe(node));
  }

  function renderFilters(filters) {
    const fill = (id, items) => {
      const select = $(id);
      items.forEach(({ value, label }) => {
        const option = el("option");
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      });
    };

    fill("fType", filters.types.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) })));
    fill("fGen", filters.generations.map((g) => ({ value: g.value, label: g.label })));
    fill("fStyle", filters.battle_styles.map((s) => ({ value: s, label: s })));
    fill("fStatus", filters.special_statuses.map((s) => ({ value: s, label: s })));
    fill("fSize", filters.size_classes.map((s) => ({ value: s, label: s })));
  }

  /* ========================================================================
     Record holders
     ===================================================================== */

  function renderSuperlatives(items) {
    const grid = $("superGrid");
    grid.innerHTML = "";
    items.forEach((item) => {
      const card = el("div", `super-card t-${item.primary_type}`);
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.innerHTML = `
        <span class="super-ico">${item.icon}</span>
        <img class="super-art" alt="" width="78" height="78">
        <div>
          <div class="super-title">${esc(item.title)}</div>
          <div class="super-name">${esc(item.display_name)}</div>
          <div class="super-val">${num(item.value)}${esc(item.unit || "")}</div>
          <div class="super-sub">${esc(item.subtitle)}</div>
        </div>`;
      attachArt(card.querySelector("img"), item.pokemon_id);
      const open = () => openModal(item.pokemon_id);
      card.addEventListener("click", open);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
      grid.appendChild(card);
    });
  }

  /* ========================================================================
     Explorer gallery
     ===================================================================== */

  function pokemonCard(pokemon) {
    const card = el("article", `poke-card t-${pokemon.primary_type}`);
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `${pokemon.display_name}, view details`);

    const flag = pokemon.special_status !== "Standard"
      ? `<span class="poke-flag flag-${esc(pokemon.special_status.split(" ")[0])}">${esc(pokemon.special_status)}</span>`
      : "";

    card.innerHTML = `
      <span class="poke-id">#${pad(pokemon.pokemon_id)}</span>
      ${flag}
      <div class="poke-art-wrap"><img class="poke-art" alt="${esc(pokemon.display_name)}" width="118" height="118"></div>
      <div class="poke-name">${esc(pokemon.display_name)}</div>
      <div class="poke-gen">${esc(pokemon.generation_label)}</div>
      <div class="badges">${typeBadges(pokemon.types)}</div>
      <div class="mini-bar"><i></i></div>
      <div class="card-foot"><span>Total stats</span><b>${num(pokemon.total_base_stats)}</b></div>`;

    attachArt(card.querySelector("img"), pokemon.pokemon_id);

    const bar = card.querySelector(".mini-bar i");
    requestAnimationFrame(() => {
      bar.style.width = `${Math.min(100, (pokemon.total_base_stats / MAX_TOTAL) * 100)}%`;
    });

    const open = () => openModal(pokemon.pokemon_id);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });

    // Light pointer tilt for depth, skipped on touch devices.
    if (window.matchMedia("(hover: hover)").matches) {
      card.addEventListener("pointermove", (e) => {
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = `perspective(700px) rotateX(${-y * 7}deg) rotateY(${x * 9}deg) translateY(-5px)`;
      });
      card.addEventListener("pointerleave", () => { card.style.transform = ""; });
    }

    return card;
  }

  function showSkeletons() {
    const grid = $("pokeGrid");
    grid.innerHTML = "";
    for (let i = 0; i < 12; i += 1) grid.appendChild(el("div", "skeleton"));
  }

  function showState(title, message, chips = []) {
    const grid = $("pokeGrid");
    grid.innerHTML = "";
    const box = el("div", "state");
    box.innerHTML = `<h3>${esc(title)}</h3><p>${esc(message)}</p>`;
    if (chips.length) {
      const row = el("div", "chips");
      chips.forEach((chip) => {
        const button = el("button", "chip");
        button.textContent = chip;
        button.addEventListener("click", () => {
          $("search").value = chip;
          state.filters.search = chip;
          state.page = 1;
          $("searchClear").classList.add("show");
          loadPokemon();
        });
        row.appendChild(button);
      });
      box.appendChild(row);
    }
    grid.appendChild(box);
    $("pager").innerHTML = "";
  }

  async function loadPokemon() {
    showSkeletons();
    const params = new URLSearchParams({ page: state.page, per_page: PER_PAGE });
    Object.entries(state.filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });

    try {
      const body = await api(`/api/pokemon?${params}`);
      renderGallery(body.data, body.pagination);
    } catch (error) {
      $("resultCount").textContent = "Could not load Pokémon.";
      showState(
        "Unable to load Pokémon data",
        `${error.message} Check that the Flask server is running, then try again.`
      );
    }
  }

  function renderGallery(items, pagination) {
    const grid = $("pokeGrid");
    const count = $("resultCount");

    if (!items.length) {
      count.innerHTML = "<b>0</b> Pokémon match those filters";
      showState(
        "No Pokémon found",
        "Nothing in the dataset matches this combination. Clear a filter, or try one of these:",
        ["Pikachu", "Charizard", "25"]
      );
      return;
    }

    count.innerHTML = `<b>${num(pagination.total)}</b> Pokémon · page ${pagination.page} of ${pagination.pages}`;
    grid.innerHTML = "";
    const fragment = document.createDocumentFragment();
    items.forEach((pokemon, i) => {
      const card = pokemonCard(pokemon);
      card.style.animationDelay = `${Math.min(i * 22, 400)}ms`;
      fragment.appendChild(card);
    });
    grid.appendChild(fragment);
    renderPager(pagination);
  }

  function renderPager(pagination) {
    const pager = $("pager");
    pager.innerHTML = "";

    const button = (label, page, { disabled = false, current = false } = {}) => {
      const node = el("button");
      node.textContent = label;
      node.disabled = disabled;
      if (current) node.setAttribute("aria-current", "page");
      if (!disabled && !current) {
        node.addEventListener("click", () => {
          state.page = page;
          loadPokemon();
          document.getElementById("explorer").scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
      pager.appendChild(node);
    };

    const { page, pages } = pagination;
    button("‹ Prev", page - 1, { disabled: !pagination.has_prev });

    // Window of page numbers around the current page, with first/last anchors.
    const window_ = new Set([1, pages, page, page - 1, page + 1]);
    if (page <= 3) [2, 3, 4].forEach((p) => window_.add(p));
    if (page >= pages - 2) [pages - 1, pages - 2, pages - 3].forEach((p) => window_.add(p));

    const list = [...window_].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
    let previous = 0;
    list.forEach((p) => {
      if (p - previous > 1) {
        const gap = el("span", "gap");
        gap.textContent = "…";
        pager.appendChild(gap);
      }
      button(String(p), p, { current: p === page });
      previous = p;
    });

    button("Next ›", page + 1, { disabled: !pagination.has_next });
  }

  /* ========================================================================
     Detail modal
     ===================================================================== */

  function statRows(stats) {
    return STAT_META.map(([key, label, color]) => `
      <div class="stat-row">
        <span>${label}</span>
        <b>${num(stats[key])}</b>
        <div class="bar"><i style="--c:${color}" data-w="${Math.min(100, (stats[key] / 255) * 100)}"></i></div>
      </div>`).join("");
  }

  function overviewPanel(p) {
    const s = p.species || {};
    const d = p.derived;
    const cells = [
      ["Height", p.height_m === null ? "—" : `${p.height_m} m`],
      ["Weight", p.weight_kg === null ? "—" : `${p.weight_kg} kg`],
      ["Size class", d.size_class],
      ["Base experience", num(p.base_experience)],
      ["Generation", p.generation_label],
      ["Colour", s.color || "—"],
      ["Status", p.special_status],
      ["Known moves", num(p.move_count)],
    ];
    const forms = p.forms.length
      ? `<div class="sub-title">OTHER FORMS OF THIS SPECIES</div>
         <div class="badges" style="justify-content:flex-start">
           ${p.forms.map((f) => `<button class="chip" data-form="${f.pokemon_id}">${esc(f.display_name)}</button>`).join("")}
         </div>`
      : "";

    return `
      <div class="kv-grid">
        ${cells.map(([k, v]) => `<div class="kv"><small>${esc(k.toUpperCase())}</small><b>${esc(v)}</b></div>`).join("")}
      </div>
      <div class="sub-title">DERIVED ANALYTICS</div>
      <div class="kv-grid">
        <div class="kv"><small>OFFENSIVE POWER</small><b>${num(d.offensive_power)}</b></div>
        <div class="kv"><small>DEFENSIVE POWER</small><b>${num(d.defensive_power)}</b></div>
        <div class="kv"><small>SPEED PERCENTILE</small><b>${num(d.speed_percentile)}%</b></div>
        <div class="kv"><small>BATTLE STYLE</small><b>${esc(d.battle_style)}</b></div>
        <div class="kv"><small>SPECIALISATION</small><b>${esc(d.stat_specialization)}</b></div>
        <div class="kv"><small>SHARE OF TOTAL</small><b>${num(d.specialization_score)}%</b></div>
      </div>
      ${forms}`;
  }

  function statsPanel(p) {
    return `
      ${statRows(p.stats)}
      <div class="total-row"><span>Total base stats</span><b>${num(p.derived.total_base_stats)}</b></div>`;
  }

  function abilitiesPanel(p) {
    if (!p.abilities.length) return `<p class="chart-note">No abilities recorded for this Pokémon.</p>`;
    return p.abilities.map((a) => `
      <div class="ability-card">
        <div>
          <b>${esc(a.display_name)}</b>
          <small>Slot ${a.slot}</small>
        </div>
        <span class="tag ${a.is_hidden ? "hidden-tag" : ""}">${a.is_hidden ? "Hidden ability" : "Standard"}</span>
      </div>`).join("");
  }

  function movesPanel(p) {
    if (!p.moves.length) {
      return `<p class="chart-note">No move records for this Pokémon in pokemon_moves.csv.</p>`;
    }
    const methods = [...new Set(p.moves.map((m) => m.learn_method))].sort();
    const buttons = ["all", ...methods].map((method) => `
      <button data-method="${esc(method)}" class="${method === state.moveFilter ? "active" : ""}">
        ${method === "all" ? `All (${p.moves.length})` : esc(method.replace(/-/g, " "))}
      </button>`).join("");

    return `
      <div class="move-filters">${buttons}</div>
      <div class="move-list" id="moveList"></div>`;
  }

  function renderMoveList(p) {
    const list = $("moveList");
    if (!list) return;
    const filtered = state.moveFilter === "all"
      ? p.moves
      : p.moves.filter((m) => m.learn_method === state.moveFilter);

    // Cap the list so a Pokemon with 400+ moves does not stall the modal.
    const shown = filtered.slice(0, 120);
    list.innerHTML = shown.map((m) => `
      <div class="move-item">
        <div>
          <b>${esc(m.display_name)}</b>
          <small>${esc(m.learn_method.replace(/-/g, " "))}${m.level_learned_at > 0 ? ` · level ${m.level_learned_at}` : ""} · ${esc(m.version_group.replace(/-/g, " "))}</small>
        </div>
        <span class="badge t-${esc(m.move_type || "unknown")}">${esc(m.move_type || "unknown")}</span>
        <span class="move-power">${m.power === null ? "—" : `${m.power} pow`}</span>
      </div>`).join("");

    if (filtered.length > shown.length) {
      const note = el("p", "chart-note");
      note.style.textAlign = "center";
      note.textContent = `Showing the first ${shown.length} of ${filtered.length} moves.`;
      list.appendChild(note);
    }
    if (!filtered.length) {
      list.innerHTML = `<p class="chart-note">No moves for that learn method.</p>`;
    }
  }

  function speciesPanel(p) {
    const s = p.species;
    if (!s) return `<p class="chart-note">No species record is linked to this Pokémon.</p>`;
    const genderText = s.gender_rate === -1
      ? "Genderless"
      : s.gender_rate === null ? "—" : `${(s.gender_rate / 8) * 100}% female`;

    const cells = [
      ["Capture rate", num(s.capture_rate)],
      ["Base happiness", num(s.base_happiness)],
      ["Growth rate", s.growth_rate || "—"],
      ["Hatch counter", num(s.hatch_counter)],
      ["Gender", genderText],
      ["Habitat", s.habitat || "Not recorded"],
      ["Colour", s.color || "—"],
      ["Shape", s.shape || "—"],
      ["Egg groups", s.egg_groups.length ? s.egg_groups.join(", ") : "Not recorded"],
    ];

    const flags = [
      s.is_baby ? `<span class="tag">Baby</span>` : "",
      s.is_legendary ? `<span class="tag hidden-tag">Legendary</span>` : "",
      s.is_mythical ? `<span class="tag hidden-tag">Mythical</span>` : "",
    ].join(" ") || `<span class="tag">Standard species</span>`;

    return `
      <div class="kv-grid">
        ${cells.map(([k, v]) => `<div class="kv"><small>${esc(k.toUpperCase())}</small><b>${esc(v)}</b></div>`).join("")}
      </div>
      <div class="sub-title">CLASSIFICATION</div>
      <div class="badges" style="justify-content:flex-start">${flags}</div>`;
  }

  const TABS = [
    ["overview", "Overview", overviewPanel],
    ["stats", "Stats", statsPanel],
    ["abilities", "Abilities", abilitiesPanel],
    ["moves", "Moves", movesPanel],
    ["species", "Species", speciesPanel],
  ];

  function selectTab(key) {
    const p = state.modalData;
    $("modalTabs").querySelectorAll(".tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === key);
    });
    const [, , renderer] = TABS.find(([k]) => k === key);
    const body = $("modalBody");
    body.innerHTML = `<div class="panel active">${renderer(p)}</div>`;

    if (key === "stats") {
      requestAnimationFrame(() => {
        body.querySelectorAll(".bar i").forEach((bar) => { bar.style.width = `${bar.dataset.w}%`; });
      });
    }
    if (key === "moves") {
      renderMoveList(p);
      body.querySelectorAll(".move-filters button").forEach((button) => {
        button.addEventListener("click", () => {
          state.moveFilter = button.dataset.method;
          body.querySelectorAll(".move-filters button").forEach((b) => b.classList.remove("active"));
          button.classList.add("active");
          renderMoveList(p);
        });
      });
    }
    if (key === "overview") {
      body.querySelectorAll("[data-form]").forEach((button) => {
        button.addEventListener("click", () => openModal(Number(button.dataset.form)));
      });
    }
  }

  async function openModal(pokemonId) {
    const backdrop = $("modalBackdrop");
    state.lastFocus = document.activeElement;
    state.moveFilter = "all";

    $("modalHero").innerHTML = `<div style="padding:30px 0;width:100%"><div class="spinner"></div><p style="text-align:center;color:var(--text-dim)">Loading Pokémon…</p></div>`;
    $("modalTabs").innerHTML = "";
    $("modalBody").innerHTML = "";
    backdrop.classList.add("open");
    document.body.style.overflow = "hidden";

    let p;
    try {
      p = (await api(`/api/pokemon/${pokemonId}`)).data;
    } catch (error) {
      $("modalHero").innerHTML = `
        <div style="padding:24px 0;width:100%;text-align:center">
          <h3 class="modal-title">Nothing to show</h3>
          <p class="modal-cat">${esc(error.message)}</p>
        </div>`;
      return;
    }

    state.modalData = p;
    const modal = $("modal");
    modal.className = `modal t-${p.primary_type}`;

    $("modalHero").innerHTML = `
      <img class="modal-art" id="modalArt" alt="${esc(p.display_name)}" width="150" height="150">
      <div>
        <div class="modal-id">#${pad(p.pokemon_id)} · ${esc(p.generation_label)}</div>
        <h3 class="modal-title" id="modalTitle">${esc(p.display_name)}</h3>
        <div class="modal-cat">${esc(p.species?.pokemon_category || p.special_status)}</div>
        <div class="badges" style="justify-content:flex-start;margin:12px 0 0">${typeBadges(p.types)}</div>
        <div class="modal-quick">
          <div><span>${num(p.derived.total_base_stats)}</span><small>TOTAL STATS</small></div>
          <div><span>${esc(p.derived.battle_style)}</span><small>BATTLE STYLE</small></div>
          <div><span>${num(p.derived.speed_percentile)}%</span><small>SPEED RANK</small></div>
          <div><span>${num(p.move_count)}</span><small>MOVES</small></div>
        </div>
      </div>`;
    attachArt($("modalArt"), p.pokemon_id, { lazy: false });

    $("modalTabs").innerHTML = TABS.map(([key, label], i) =>
      `<button class="tab ${i === 0 ? "active" : ""}" data-tab="${key}">${label}</button>`).join("");
    $("modalTabs").querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => selectTab(tab.dataset.tab));
    });

    selectTab("overview");
    $("modalClose").focus();
  }

  function closeModal() {
    $("modalBackdrop").classList.remove("open");
    document.body.style.overflow = "";
    if (state.lastFocus) state.lastFocus.focus();
  }

  /* ========================================================================
     Random Pokemon
     ===================================================================== */

  async function rollRandom({ scroll = false } = {}) {
    const art = $("randomArt");
    art.classList.remove("rolling");
    void art.offsetWidth; // restart the animation
    art.classList.add("rolling");

    try {
      const p = (await api("/api/pokemon/random")).data;
      state.randomPokemon = p;

      $("randomPanel").style.setProperty("--type", typeColor(p.primary_type));
      $("randomName").textContent = p.display_name;
      $("randomSub").textContent =
        `#${pad(p.pokemon_id)} · ${p.generation_label} · ${p.species?.pokemon_category || p.special_status}`;
      $("randomTypes").innerHTML = typeBadges(p.types);
      $("randomStats").innerHTML = `
        <div><span>${num(p.derived.total_base_stats)}</span><small>TOTAL STATS</small></div>
        <div><span>${num(p.stats.attack)}</span><small>ATTACK</small></div>
        <div><span>${num(p.stats.defense)}</span><small>DEFENSE</small></div>
        <div><span>${num(p.stats.speed)}</span><small>SPEED</small></div>
        <div><span>${esc(p.derived.battle_style)}</span><small>STYLE</small></div>`;
      attachArt(art, p.pokemon_id, { lazy: false });

      if (scroll) $("random").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
      $("randomName").textContent = "Could not pick a Pokémon";
      $("randomSub").textContent = error.message;
    }
  }

  /* ========================================================================
     Compare
     ===================================================================== */

  function compareRow(label, left, right, unit = "") {
    const max = Math.max(left ?? 0, right ?? 0) || 1;
    const leftPct = ((left ?? 0) / max) * 100;
    const rightPct = ((right ?? 0) / max) * 100;
    const leftWin = (left ?? 0) > (right ?? 0);
    const rightWin = (right ?? 0) > (left ?? 0);

    return `
      <div class="cmp-row">
        <div class="cmp-side left">
          <span class="cmp-val ${leftWin ? "win" : ""}">${left === null ? "—" : num(left)}${unit}</span>
          <div class="cmp-track left"><i data-w="${leftPct}"></i></div>
        </div>
        <div class="cmp-label">${esc(label)}</div>
        <div class="cmp-side right">
          <span class="cmp-val ${rightWin ? "win" : ""}">${right === null ? "—" : num(right)}${unit}</span>
          <div class="cmp-track right"><i data-w="${rightPct}"></i></div>
        </div>
      </div>`;
  }

  async function runCompare() {
    const idA = $("cmpA").value;
    const idB = $("cmpB").value;
    const body = $("compareBody");
    if (!idA || !idB) return;

    body.innerHTML = `<div style="padding:30px"><div class="spinner"></div></div>`;

    let a;
    let b;
    try {
      [a, b] = await Promise.all([
        api(`/api/pokemon/${idA}`).then((r) => r.data),
        api(`/api/pokemon/${idB}`).then((r) => r.data),
      ]);
    } catch (error) {
      body.innerHTML = `<p class="chart-note" style="text-align:center">${esc(error.message)}</p>`;
      return;
    }

    const rows = [
      ...STAT_META.map(([key, label]) => compareRow(label, a.stats[key], b.stats[key])),
      compareRow("Total", a.derived.total_base_stats, b.derived.total_base_stats),
      compareRow("Height", a.height_m, b.height_m, " m"),
      compareRow("Weight", a.weight_kg, b.weight_kg, " kg"),
    ].join("");

    body.innerHTML = `
      <div class="compare-heads">
        <div class="compare-head"><img id="cmpArtA" alt="${esc(a.display_name)}"><b>${esc(a.display_name)}</b><div class="badges">${typeBadges(a.types)}</div></div>
        <div class="compare-head"><img id="cmpArtB" alt="${esc(b.display_name)}"><b>${esc(b.display_name)}</b><div class="badges">${typeBadges(b.types)}</div></div>
      </div>
      ${rows}`;

    attachArt($("cmpArtA"), a.pokemon_id, { lazy: false });
    attachArt($("cmpArtB"), b.pokemon_id, { lazy: false });

    requestAnimationFrame(() => {
      body.querySelectorAll(".cmp-track i").forEach((bar) => { bar.style.width = `${bar.dataset.w}%`; });
    });
  }

  async function initCompare() {
    try {
      const list = (await api("/api/pokemon/index")).data;
      state.index = list;
      const options = list
        .map((p) => `<option value="${p.pokemon_id}">${esc(p.display_name)}</option>`)
        .join("");
      $("cmpA").innerHTML = options;
      $("cmpB").innerHTML = options;
      $("cmpA").value = "25";   // Pikachu
      $("cmpB").value = "6";    // Charizard
      $("cmpA").addEventListener("change", runCompare);
      $("cmpB").addEventListener("change", runCompare);
      runCompare();
    } catch (error) {
      $("compareBody").innerHTML = `<p class="chart-note" style="text-align:center">Comparison is unavailable: ${esc(error.message)}</p>`;
    }
  }

  /* ========================================================================
     Charts
     ===================================================================== */

  function chartDefaults() {
    Chart.defaults.color = "#a6b3d9";
    Chart.defaults.font.family = "Outfit, system-ui, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.plugins.tooltip.backgroundColor = "rgba(8,12,26,.95)";
    Chart.defaults.plugins.tooltip.borderColor = "rgba(129,152,214,.3)";
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.titleFont = { family: "Chakra Petch", size: 13 };
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
  }

  const gridLine = { color: "rgba(129,152,214,.1)" };

  function makeChart(canvasId, config) {
    const canvas = $(canvasId);
    if (!canvas) return null;
    try {
      state.charts[canvasId] = new Chart(canvas, config);
      return state.charts[canvasId];
    } catch (error) {
      canvas.parentElement.innerHTML = `<div class="chart-fallback">This chart could not be drawn.</div>`;
      return null;
    }
  }

  function chartUnavailable(canvasId, message) {
    const canvas = $(canvasId);
    if (canvas) canvas.parentElement.innerHTML = `<div class="chart-fallback">${esc(message)}</div>`;
  }

  function renderCharts(a) {
    // 1 - type distribution
    if (a.type_distribution.values.length) {
      makeChart("chartTypes", {
        type: "doughnut",
        data: {
          labels: a.type_distribution.labels,
          datasets: [{
            data: a.type_distribution.values,
            backgroundColor: a.type_distribution.keys.map(typeColor),
            borderColor: "rgba(8,11,24,.85)",
            borderWidth: 2,
            hoverOffset: 10,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: "56%",
          plugins: {
            legend: { position: "right", labels: { padding: 8, font: { size: 11 } } },
            tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.parsed} Pokémon` } },
          },
        },
      });
    } else {
      chartUnavailable("chartTypes", "No type data available.");
    }

    // 2 - generations
    makeChart("chartGens", {
      type: "bar",
      data: {
        labels: a.generations.labels,
        datasets: [{
          label: "Species",
          data: a.generations.values,
          backgroundColor: (ctx) => {
            const { chart } = ctx;
            if (!chart.chartArea) return "#e3350d";
            const g = chart.ctx.createLinearGradient(0, chart.chartArea.bottom, 0, chart.chartArea.top);
            g.addColorStop(0, "rgba(227,53,13,.55)");
            g.addColorStop(1, "#ffcb05");
            return g;
          },
          borderRadius: 7,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, grid: gridLine }, x: { grid: { display: false } } },
      },
    });

    // 3 - battle style
    makeChart("chartStyle", {
      type: "doughnut",
      data: {
        labels: a.battle_style.labels,
        datasets: [{
          data: a.battle_style.values,
          backgroundColor: a.battle_style.labels.map((label) =>
            ({ Offensive: "#e3350d", Defensive: "#38bdf8", Balanced: "#8b5cf6" }[label] || "#64748b")),
          borderColor: "rgba(8,11,24,.85)",
          borderWidth: 2,
          hoverOffset: 10,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "58%",
        plugins: { legend: { position: "bottom" } },
      },
    });

    // 4 - top 10 totals
    makeChart("chartTop", {
      type: "bar",
      data: {
        labels: a.top_stats.labels,
        datasets: [{
          label: "Total base stats",
          data: a.top_stats.values,
          backgroundColor: a.top_stats.types.map((t) => `${typeColor(t)}cc`),
          borderColor: a.top_stats.types.map(typeColor),
          borderWidth: 1,
          borderRadius: 6,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, grid: gridLine }, y: { grid: { display: false } } },
        onClick: (_, elements) => {
          if (elements.length) openModal(a.top_stats.ids[elements[0].index]);
        },
      },
    });

    // 5 - attack vs defense, grouped into one dataset per type
    const byType = {};
    a.attack_defense.points.forEach((point) => {
      (byType[point.type] ||= []).push(point);
    });
    $("scatterCount").textContent = `${num(a.attack_defense.points.length)} Pokémon`;

    makeChart("chartScatter", {
      type: "scatter",
      data: {
        datasets: Object.entries(byType).map(([type, points]) => ({
          label: type,
          data: points,
          backgroundColor: `${typeColor(type)}b3`,
          borderColor: typeColor(type),
          borderWidth: 0.5,
          pointRadius: 3.5,
          pointHoverRadius: 7,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 8, padding: 9, font: { size: 10 } } },
          tooltip: {
            callbacks: {
              label: (c) => ` ${c.raw.name} — attack ${c.raw.x}, defense ${c.raw.y}`,
            },
          },
        },
        scales: {
          x: { title: { display: true, text: "Attack" }, grid: gridLine, beginAtZero: true },
          y: { title: { display: true, text: "Defense" }, grid: gridLine, beginAtZero: true },
        },
        onClick: (_, elements) => {
          if (elements.length) {
            const point = elements[0].element.$context.raw;
            if (point?.id) openModal(point.id);
          }
        },
      },
    });

    // 6 - speed distribution
    $("speedMedian").textContent = `median ${a.speed.median}`;
    makeChart("chartSpeed", {
      type: "bar",
      data: {
        labels: a.speed.labels,
        datasets: [{
          label: "Pokémon",
          data: a.speed.values,
          backgroundColor: "rgba(56,189,248,.65)",
          borderColor: "#38bdf8",
          borderWidth: 1,
          borderRadius: 5,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (c) => `Speed ${c[0].label}` } } },
        scales: {
          y: { beginAtZero: true, grid: gridLine, title: { display: true, text: "Pokémon" } },
          x: { grid: { display: false } },
        },
      },
    });

    // 7 - moves by type
    makeChart("chartMoves", {
      type: "bar",
      data: {
        labels: a.moves.move_types.labels,
        datasets: [{
          label: "Moves",
          data: a.moves.move_types.values,
          backgroundColor: a.moves.move_types.keys.map((t) => `${typeColor(t)}cc`),
          borderRadius: 5,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: gridLine },
          x: { grid: { display: false }, ticks: { maxRotation: 60, minRotation: 45, font: { size: 10 } } },
        },
      },
    });

    // 7b - damage class
    makeChart("chartDamage", {
      type: "polarArea",
      data: {
        labels: a.moves.damage_class.labels,
        datasets: [{
          data: a.moves.damage_class.values,
          backgroundColor: ["rgba(227,53,13,.7)", "rgba(139,92,246,.7)", "rgba(56,189,248,.7)"],
          borderColor: "rgba(8,11,24,.8)",
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
        scales: { r: { grid: gridLine, ticks: { display: false } } },
      },
    });

    // top power moves table
    const rows = a.moves.top_power.map((m) => `
      <tr>
        <td>${esc(m.move_name)}</td>
        <td><span class="badge t-${esc(m.move_type)}">${esc(m.move_type)}</span></td>
        <td>${esc(m.damage_class)}</td>
        <td>${num(m.power)}</td>
      </tr>`).join("");
    $("topMoves").innerHTML = a.moves.top_power.length
      ? `<table class="move-table">
           <thead><tr><th>MOVE</th><th>TYPE</th><th>CLASS</th><th>POWER</th></tr></thead>
           <tbody>${rows}</tbody>
         </table>`
      : `<div class="chart-fallback">No move power values recorded.</div>`;
  }

  async function loadAnalytics() {
    try {
      const analytics = (await api("/api/analytics/all")).data;
      chartDefaults();
      renderCharts(analytics);
    } catch (error) {
      document.querySelectorAll(".chart-box").forEach((box) => {
        box.innerHTML = `<div class="chart-fallback">Analytics are unavailable right now.</div>`;
      });
      $("topMoves").innerHTML = `<div class="chart-fallback">${esc(error.message)}</div>`;
    }
  }

  /* ========================================================================
     Hero showcase
     ===================================================================== */

  function startShowcase() {
    const featured = [6, 25, 149, 448, 445, 658, 887, 1017, 9, 249];
    let i = 0;

    const show = async (id) => {
      try {
        const p = (await api(`/api/pokemon/${id}`)).data;
        const art = $("showcaseArt");
        art.style.opacity = "0";
        setTimeout(() => {
          attachArt(art, p.pokemon_id, { lazy: false });
          art.alt = p.display_name;
          art.style.opacity = "1";
          $("showcaseName").textContent = p.display_name;
          $("showcaseId").textContent = `#${pad(p.pokemon_id)} · ${p.generation_label}`;
          $("showcaseTypes").innerHTML = typeBadges(p.types);
          $("showcaseGlow").style.setProperty("--type", typeColor(p.primary_type));
        }, 260);
      } catch {
        $("showcaseName").textContent = "Artwork unavailable";
      }
    };

    show(featured[0]);
    $("showcase").addEventListener("click", () => {
      const current = featured[i % featured.length];
      openModal(current);
    });
    setInterval(() => {
      i += 1;
      show(featured[i % featured.length]);
    }, 5200);
  }

  /* ========================================================================
     Wiring
     ===================================================================== */

  function bindControls() {
    const onSearch = debounce(() => {
      state.filters.search = $("search").value.trim();
      state.page = 1;
      loadPokemon();
    }, 260);

    $("search").addEventListener("input", () => {
      $("searchClear").classList.toggle("show", $("search").value.length > 0);
      onSearch();
    });

    $("searchClear").addEventListener("click", () => {
      $("search").value = "";
      $("searchClear").classList.remove("show");
      state.filters.search = "";
      state.page = 1;
      loadPokemon();
    });

    const selects = {
      fType: "type", fGen: "generation", fStyle: "battle_style",
      fStatus: "special_status", fSize: "size_class", fSort: "sort",
    };
    Object.entries(selects).forEach(([id, key]) => {
      $(id).addEventListener("change", () => {
        state.filters[key] = $(id).value;
        state.page = 1;
        loadPokemon();
      });
    });

    $("resetFilters").addEventListener("click", () => {
      $("search").value = "";
      $("searchClear").classList.remove("show");
      Object.keys(selects).forEach((id) => { $(id).value = id === "fSort" ? "id" : ""; });
      state.filters = { search: "", type: "", generation: "", battle_style: "", special_status: "", size_class: "", sort: "id" };
      state.page = 1;
      loadPokemon();
      toast("Filters cleared");
    });

    $("surpriseBtn").addEventListener("click", () => rollRandom());
    $("surpriseTop").addEventListener("click", () => rollRandom({ scroll: true }));
    $("randomDetails").addEventListener("click", () => {
      if (state.randomPokemon) openModal(state.randomPokemon.pokemon_id);
    });

    $("modalClose").addEventListener("click", closeModal);
    $("modalBackdrop").addEventListener("click", (e) => {
      if (e.target === $("modalBackdrop")) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && $("modalBackdrop").classList.contains("open")) closeModal();
    });

    const nav = $("nav");
    $("navToggle").addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      $("navToggle").setAttribute("aria-expanded", String(open));
    });
    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => nav.classList.remove("open"));
    });
  }

  async function init() {
    buildOrbs();
    bindControls();

    try {
      const summary = (await api("/api/summary")).data;
      state.summary = summary;
      renderSummary(summary);
      renderFilters(summary.filters);
      renderSuperlatives(summary.superlatives);
    } catch (error) {
      $("statGrid").innerHTML = `<div class="state"><h3>Unable to load the dataset</h3><p>${esc(error.message)}</p></div>`;
      $("superGrid").innerHTML = "";
    }

    loadPokemon();
    startShowcase();
    rollRandom();
    initCompare();
    loadAnalytics();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
