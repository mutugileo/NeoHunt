const config = window.NEOHUNT_CONFIG || {};

const state = {
  jobs: [],
  selectedId: null,
  saved: new Set(JSON.parse(localStorage.getItem("neohunt:saved") || "[]")),
};

const elements = {
  refreshButton: document.querySelector("#refreshButton"),
  searchInput: document.querySelector("#searchInput"),
  scoreFilter: document.querySelector("#scoreFilter"),
  jobList: document.querySelector("#jobList"),
  emptyState: document.querySelector("#emptyState"),
  detailsContent: document.querySelector("#detailsContent"),
  matchCount: document.querySelector("#matchCount"),
  topScore: document.querySelector("#topScore"),
  lastSync: document.querySelector("#lastSync"),
};

function authHeaders() {
  return {
    apikey: config.supabaseAnonKey,
    Authorization: `Bearer ${config.supabaseAnonKey}`,
  };
}

async function fetchJson(path) {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error("Missing Supabase website config.");
  }

  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Supabase request failed with ${response.status}`);
  }

  return response.json();
}

async function loadJobs() {
  setLoading(true);
  try {
    const jobs = await fetchJson("jobs?select=*&order=score.desc.nullslast&order=scraped_at.desc&limit=100");
    const matches = await fetchMatches(jobs);
    state.jobs = jobs.map((job) => ({
      ...job,
      match: matches.get(job.id) || null,
    }));
    state.selectedId = state.selectedId || state.jobs[0]?.id || null;
    render();
  } catch (error) {
    renderError(error);
  } finally {
    setLoading(false);
  }
}

async function fetchMatches(jobs) {
  if (!jobs.length) {
    return new Map();
  }
  const matches = await fetchJson("matches?select=*");
  return new Map(matches.map((match) => [match.job_id, match]));
}

function filteredJobs() {
  const term = elements.searchInput.value.trim().toLowerCase();
  const minimumScore = Number(elements.scoreFilter.value || 0);

  return state.jobs.filter((job) => {
    const haystack = [job.company, job.title, job.location, job.description, job.match?.strengths]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return (job.score || 0) >= minimumScore && (!term || haystack.includes(term));
  });
}

function render() {
  const jobs = filteredJobs();
  const selected = jobs.find((job) => job.id === state.selectedId) || jobs[0] || null;
  state.selectedId = selected?.id || null;

  elements.matchCount.textContent = String(jobs.length);
  elements.topScore.textContent = jobs.length ? `${jobs[0].score || 0}%` : "0%";
  elements.lastSync.textContent = latestSyncLabel(state.jobs);
  elements.emptyState.hidden = jobs.length > 0;
  elements.jobList.innerHTML = jobs.map(jobRow).join("");

  document.querySelectorAll(".job-row").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.id;
      render();
    });
  });

  renderDetails(selected);
}

function jobRow(job) {
  const isActive = job.id === state.selectedId ? " active" : "";
  const location = job.location || "Location not shown";
  const saved = state.saved.has(job.id) ? "Saved" : job.match?.decision || "New";

  return `
    <button class="job-row${isActive}" type="button" data-id="${escapeHtml(job.id)}">
      <span>
        <span class="company">${escapeHtml(job.company)}</span>
        <h3>${escapeHtml(job.title)}</h3>
        <span class="meta">
          <span>${escapeHtml(location)}</span>
          <span>${escapeHtml(saved)}</span>
        </span>
      </span>
      <span class="score">${Number(job.score || 0)}%</span>
    </button>
  `;
}

function renderDetails(job) {
  if (!job) {
    elements.detailsContent.innerHTML = `
      <p class="eyebrow">No roles</p>
      <h2>The board is empty.</h2>
      <p class="muted">Run the scraper after setting the Supabase service key, then refresh this website.</p>
    `;
    return;
  }

  const match = job.match || {};
  const saved = state.saved.has(job.id);
  elements.detailsContent.innerHTML = `
    <p class="eyebrow">${escapeHtml(job.company)}</p>
    <h2>${escapeHtml(job.title)}</h2>
    <div class="detail-grid">
      <div>
        <span>Location</span>
        <strong>${escapeHtml(job.location || "Not shown")}</strong>
      </div>
      <div>
        <span>Score</span>
        <strong>${Number(match.match_score || job.score || 0)}%</strong>
      </div>
    </div>
    <div class="analysis">
      <section>
        <h3>Why it fits</h3>
        <p>${escapeHtml(match.strengths || "The role needs a closer read once the job page exposes more detail.")}</p>
      </section>
      <section>
        <h3>Gaps</h3>
        <p>${escapeHtml(match.gaps || "None significant from the scraped text.")}</p>
      </section>
      <section>
        <h3>CV Positioning</h3>
        <p>${escapeHtml(match.cv_angle || "Lead with product ownership, payments scale, and delivery across markets.")}</p>
      </section>
    </div>
    <div class="actions">
      <a class="primary-action" href="${escapeAttribute(job.job_url || "#")}" target="_blank" rel="noreferrer">Apply</a>
      <a class="secondary-action" href="${escapeAttribute(job.source || job.job_url || "#")}" target="_blank" rel="noreferrer">Open Website</a>
      <button class="secondary-action" type="button" id="saveButton">${saved ? "Saved" : "Save"}</button>
    </div>
  `;

  document.querySelector("#saveButton").addEventListener("click", () => {
    if (state.saved.has(job.id)) {
      state.saved.delete(job.id);
    } else {
      state.saved.add(job.id);
    }
    localStorage.setItem("neohunt:saved", JSON.stringify([...state.saved]));
    render();
  });
}

function latestSyncLabel(jobs) {
  const latest = jobs
    .map((job) => job.scraped_at)
    .filter(Boolean)
    .sort()
    .at(-1);

  if (!latest) {
    return "Waiting";
  }

  return new Intl.DateTimeFormat("en-KE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(latest));
}

function setLoading(isLoading) {
  elements.refreshButton.disabled = isLoading;
  elements.refreshButton.style.opacity = isLoading ? "0.55" : "1";
}

function renderError(error) {
  elements.jobList.innerHTML = "";
  elements.emptyState.hidden = true;
  elements.detailsContent.innerHTML = `
    <p class="eyebrow">Connection</p>
    <h2>NeoHunt could not load jobs.</h2>
    <p class="error-state">${escapeHtml(error.message)}</p>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

elements.refreshButton.addEventListener("click", loadJobs);
elements.searchInput.addEventListener("input", render);
elements.scoreFilter.addEventListener("change", render);

loadJobs();
