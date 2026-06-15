const config = window.NEOHUNT_CONFIG || {};
const isDetailPage = Boolean(document.querySelector("#jobPost"));

const COUNTRIES = [
  "Kenya",
  "Nigeria",
  "South Africa",
  "Ghana",
  "Uganda",
  "Tanzania",
  "Rwanda",
  "Ethiopia",
  "Zambia",
  "Zimbabwe",
  "United Kingdom",
  "United States",
  "Remote",
  "Worldwide",
];

const DEFAULT_COMPANIES = [
  "Visa",
  "Mastercard",
  "Safaricom",
  "Microsoft",
  "Amazon",
  "One Acre Fund",
  "M-KOPA",
  "Flutterwave",
  "Standard Bank",
  "Absa",
  "KCB",
  "NCBA",
];

const DEFAULT_KEYWORDS = [
  "technical product manager",
  "technical program manager",
  "product manager",
  "payments",
  "platform",
  "banking",
];

const PENDING_PREFERENCES_KEY = "neohunt:pendingPreferences";

const state = {
  client: null,
  session: null,
  preferences: null,
  jobs: [],
  selectedId: null,
  saved: new Set(),
};

const elements = {
  pageTitle: document.querySelector("#pageTitle"),
  authView: document.querySelector("#authView"),
  appView: document.querySelector("#appView"),
  loginTab: document.querySelector("#loginTab"),
  registerTab: document.querySelector("#registerTab"),
  loginForm: document.querySelector("#loginForm"),
  registerForm: document.querySelector("#registerForm"),
  authMessage: document.querySelector("#authMessage"),
  loginEmail: document.querySelector("#loginEmail"),
  loginPassword: document.querySelector("#loginPassword"),
  registerName: document.querySelector("#registerName"),
  registerEmail: document.querySelector("#registerEmail"),
  registerPassword: document.querySelector("#registerPassword"),
  registerCountry: document.querySelector("#registerCountry"),
  registerRegion: document.querySelector("#registerRegion"),
  registerKeywords: document.querySelector("#registerKeywords"),
  registerCompanies: document.querySelector("#registerCompanies"),
  refreshButton: document.querySelector("#refreshButton"),
  signOutButton: document.querySelector("#signOutButton"),
  preferencesForm: document.querySelector("#preferencesForm"),
  preferencesMessage: document.querySelector("#preferencesMessage"),
  welcomeTitle: document.querySelector("#welcomeTitle"),
  countryInput: document.querySelector("#countryInput"),
  regionInput: document.querySelector("#regionInput"),
  keywordsInput: document.querySelector("#keywordsInput"),
  companiesInput: document.querySelector("#companiesInput"),
  searchInput: document.querySelector("#searchInput"),
  scoreFilter: document.querySelector("#scoreFilter"),
  jobList: document.querySelector("#jobList"),
  emptyState: document.querySelector("#emptyState"),
  detailsContent: document.querySelector("#detailsContent"),
  jobPost: document.querySelector("#jobPost"),
  matchCount: document.querySelector("#matchCount"),
  topScore: document.querySelector("#topScore"),
  lastSync: document.querySelector("#lastSync"),
};

function requireConfig() {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error("Missing Supabase website config.");
  }
}

function getClient() {
  requireConfig();
  if (!state.client) {
    state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  }
  return state.client;
}

function populateCountries(select) {
  if (!select) {
    return;
  }
  select.innerHTML = COUNTRIES.map((country) => `<option value="${escapeAttribute(country)}">${escapeHtml(country)}</option>`).join("");
}

function parseList(value) {
  return String(value || "")
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index);
}

function listToText(values) {
  return (values || []).join(", ");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function readPendingPreferences(email) {
  const pending = JSON.parse(localStorage.getItem(PENDING_PREFERENCES_KEY) || "{}");
  return pending[normalizeEmail(email)] || null;
}

function writePendingPreferences(email, values) {
  const pending = JSON.parse(localStorage.getItem(PENDING_PREFERENCES_KEY) || "{}");
  pending[normalizeEmail(email)] = values;
  localStorage.setItem(PENDING_PREFERENCES_KEY, JSON.stringify(pending));
}

function clearPendingPreferences(email) {
  const pending = JSON.parse(localStorage.getItem(PENDING_PREFERENCES_KEY) || "{}");
  delete pending[normalizeEmail(email)];
  localStorage.setItem(PENDING_PREFERENCES_KEY, JSON.stringify(pending));
}

function savedJobsKey() {
  return `neohunt:saved:${state.session?.user?.id || "guest"}`;
}

function loadSavedJobs() {
  state.saved = new Set(JSON.parse(localStorage.getItem(savedJobsKey()) || "[]"));
}

function persistSavedJobs() {
  localStorage.setItem(savedJobsKey(), JSON.stringify([...state.saved]));
}

function defaultPreferences(user) {
  return {
    user_id: user.id,
    full_name: user.user_metadata?.full_name || "",
    country: "Kenya",
    region: "Nairobi",
    keywords: DEFAULT_KEYWORDS,
    companies: DEFAULT_COMPANIES,
  };
}

function preferencePayload(user, values) {
  return {
    user_id: user.id,
    full_name: values.full_name || "",
    country: values.country || "Kenya",
    region: values.region || null,
    keywords: values.keywords,
    companies: values.companies,
    updated_at: new Date().toISOString(),
  };
}

async function savePreferences(values) {
  const user = state.session?.user;
  if (!user) {
    throw new Error("Login before saving preferences.");
  }

  const { data, error } = await getClient()
    .from("user_preferences")
    .upsert(preferencePayload(user, values), { onConflict: "user_id" })
    .select()
    .single();

  if (error) {
    throw error;
  }

  state.preferences = data;
  return data;
}

async function applyPendingPreferences(user) {
  const pending = readPendingPreferences(user?.email);
  if (!pending) {
    return false;
  }

  validatePreferences(pending);
  await savePreferences(pending);
  clearPendingPreferences(user.email);
  return true;
}

async function loadPreferences() {
  const user = state.session?.user;
  if (!user) {
    return null;
  }

  const { data, error, status } = await getClient()
    .from("user_preferences")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error && status !== 406) {
    throw error;
  }

  if (data) {
    state.preferences = data;
    return data;
  }

  return savePreferences(defaultPreferences(user));
}

async function loadJobs() {
  const { data: jobs, error: jobsError } = await getClient()
    .from("jobs")
    .select("*")
    .order("score", { ascending: false, nullsFirst: false })
    .order("scraped_at", { ascending: false })
    .limit(300);

  if (jobsError) {
    throw jobsError;
  }

  const { data: matches, error: matchesError } = await getClient().from("matches").select("*");
  if (matchesError) {
    throw matchesError;
  }

  const matchMap = new Map((matches || []).map((match) => [match.job_id, match]));
  state.jobs = (jobs || []).map((job) => ({ ...job, match: matchMap.get(job.id) || null }));
  state.selectedId = state.selectedId || state.jobs[0]?.id || null;
}

function preferenceMatches(job) {
  const preferences = state.preferences;
  if (!preferences) {
    return false;
  }

  const companyList = (preferences.companies || []).map((company) => company.toLowerCase());
  const keywordList = (preferences.keywords || []).map((keyword) => keyword.toLowerCase());
  const country = (preferences.country || "").toLowerCase();
  const region = (preferences.region || "").toLowerCase();
  const haystack = [
    job.company,
    job.title,
    job.location,
    job.description,
    job.source,
    job.match?.strengths,
    job.match?.gaps,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const companyMatches =
    companyList.length === 0 ||
    companyList.some((company) => job.company.toLowerCase() === company || haystack.includes(company));
  const keywordMatches = keywordList.length === 0 || keywordList.some((keyword) => haystack.includes(keyword));
  const locationMatches =
    !country ||
    country === "worldwide" ||
    country === "remote" ||
    haystack.includes(country) ||
    (region && haystack.includes(region)) ||
    haystack.includes("remote");

  return companyMatches && keywordMatches && locationMatches;
}

function filteredJobs() {
  const term = elements.searchInput?.value.trim().toLowerCase() || "";
  const minimumScore = Number(elements.scoreFilter?.value || 0);

  return state.jobs.filter((job) => {
    const haystack = [job.company, job.title, job.location, job.description, job.match?.strengths]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return preferenceMatches(job) && (job.score || 0) >= minimumScore && (!term || haystack.includes(term));
  });
}

function renderPreferenceForm() {
  const preferences = state.preferences || {};
  const fullName = preferences.full_name || state.session?.user?.email || "there";
  elements.welcomeTitle.textContent = `Welcome, ${fullName.split(" ")[0] || "there"}`;
  elements.countryInput.value = preferences.country || "Kenya";
  elements.regionInput.value = preferences.region || "";
  elements.keywordsInput.value = listToText(preferences.keywords || DEFAULT_KEYWORDS);
  elements.companiesInput.value = listToText(preferences.companies || DEFAULT_COMPANIES);
}

function showApp() {
  elements.authView.hidden = true;
  elements.appView.hidden = false;
  elements.refreshButton.hidden = false;
  elements.signOutButton.hidden = false;
  elements.pageTitle.textContent = "Your Job Radar";
}

function showAuth() {
  elements.authView.hidden = false;
  elements.appView.hidden = true;
  elements.refreshButton.hidden = true;
  elements.signOutButton.hidden = true;
  elements.pageTitle.textContent = "Your Job Radar";
}

function renderList() {
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
      renderList();
    });
  });

  renderListDetails(selected);
}

function jobRow(job) {
  const isActive = job.id === state.selectedId ? " active" : "";
  const location = job.location || "Location not shown";
  const saved = state.saved.has(job.id) ? "Saved" : job.match?.decision || "New";

  return `
    <button class="job-row${isActive}" type="button" data-id="${escapeAttribute(job.id)}">
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

function buildJobPageUrl(job) {
  return `./job.html?id=${encodeURIComponent(job.id)}`;
}

function renderListDetails(job) {
  if (!job) {
    elements.detailsContent.innerHTML = `
      <p class="eyebrow">No roles</p>
      <h2>Your radar is quiet.</h2>
      <p class="muted">Try a nearby region, another company, or broader keywords like product, payments, platform, or program.</p>
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
        <p>${escapeHtml(match.strengths || "This role matched your saved radar.")}</p>
      </section>
      <section>
        <h3>Gaps</h3>
        <p>${escapeHtml(match.gaps || "Check the company post before applying.")}</p>
      </section>
      <section>
        <h3>CV Positioning</h3>
        <p>${escapeHtml(match.cv_angle || "Lead with product ownership, payments scale, and delivery across markets.")}</p>
      </section>
    </div>
    <div class="actions">
      <a class="primary-action" href="${escapeAttribute(job.job_url || job.source || "#")}" target="_blank" rel="noreferrer">Apply</a>
      <a class="secondary-action" href="${escapeAttribute(buildJobPageUrl(job))}">View details</a>
      <button class="secondary-action" type="button" id="saveButton">${saved ? "Saved" : "Save"}</button>
    </div>
  `;

  document.querySelector("#saveButton").addEventListener("click", () => {
    if (state.saved.has(job.id)) {
      state.saved.delete(job.id);
    } else {
      state.saved.add(job.id);
    }
    persistSavedJobs();
    renderList();
  });
}

async function loadListPage() {
  setLoading(true);
  try {
    showApp();
    loadSavedJobs();
    await loadPreferences();
    renderPreferenceForm();
    await loadJobs();
    renderList();
  } catch (error) {
    renderError(error);
  } finally {
    setLoading(false);
  }
}

async function bootHome() {
  populateCountries(elements.registerCountry);
  populateCountries(elements.countryInput);
  elements.registerRegion.value = "Nairobi";
  elements.registerKeywords.value = listToText(DEFAULT_KEYWORDS);
  elements.registerCompanies.value = listToText(DEFAULT_COMPANIES);

  const { data } = await getClient().auth.getSession();
  state.session = data.session;
  if (!state.session) {
    showAuth();
    return;
  }

  await applyPendingPreferences(state.session.user);
  await loadListPage();
}

async function loadDetailPage() {
  setLoading(true);
  try {
    const { data } = await getClient().auth.getSession();
    state.session = data.session;
    if (!state.session) {
      renderDetailError(new Error("Login on the home page before opening job details."));
      return;
    }
    loadSavedJobs();

    await loadPreferences();
    const jobId = new URLSearchParams(window.location.search).get("id") || "";
    if (!jobId) {
      renderDetailError(new Error("Missing job id in the URL."));
      return;
    }

    const { data: job, error: jobError } = await getClient().from("jobs").select("*").eq("id", jobId).maybeSingle();
    if (jobError) {
      throw jobError;
    }
    const { data: match, error: matchError } = await getClient().from("matches").select("*").eq("job_id", jobId).maybeSingle();
    if (matchError) {
      throw matchError;
    }

    const hydrated = job ? { ...job, match: match || null } : null;
    if (hydrated && !preferenceMatches(hydrated)) {
      renderDetailError(new Error("This job is outside your saved country, company, or keyword radar."));
      return;
    }
    renderJobPost(hydrated);
  } catch (error) {
    renderDetailError(error);
  } finally {
    setLoading(false);
  }
}

function renderJobPost(job) {
  if (!job) {
    renderDetailError(new Error("That job could not be found in Supabase."));
    return;
  }

  const match = job.match || {};
  const saved = state.saved.has(job.id);
  elements.jobPost.innerHTML = `
    <div class="post-hero">
      <p class="eyebrow">${escapeHtml(job.company)}</p>
      <h1>${escapeHtml(job.title)}</h1>
      <p class="muted">${escapeHtml(job.location || "Location not shown")} · ${Number(match.match_score || job.score || 0)}% match</p>
    </div>

    <div class="detail-grid detail-grid-wide">
      <div>
        <span>Score</span>
        <strong>${Number(match.match_score || job.score || 0)}%</strong>
      </div>
      <div>
        <span>Status</span>
        <strong>${escapeHtml(job.status || "new")}</strong>
      </div>
    </div>

    <div class="analysis">
      <section>
        <h3>Why it fits</h3>
        <p>${escapeHtml(match.strengths || "This role matched your saved radar.")}</p>
      </section>
      <section>
        <h3>Gaps</h3>
        <p>${escapeHtml(match.gaps || "Check the company post before applying.")}</p>
      </section>
      <section>
        <h3>CV Positioning</h3>
        <p>${escapeHtml(match.cv_angle || "Lead with product ownership, payments scale, and delivery across markets.")}</p>
      </section>
      <section>
        <h3>Description</h3>
        <p>${escapeHtml(job.description || "The scraped post did not include a longer description yet.")}</p>
      </section>
    </div>

    <div class="actions">
      <a class="primary-action" href="${escapeAttribute(job.job_url || "#")}" target="_blank" rel="noreferrer">Apply on company site</a>
      <a class="secondary-action" href="./">Back to feed</a>
      <button class="secondary-action" type="button" id="saveButton">${saved ? "Saved" : "Save"}</button>
    </div>
  `;

  document.querySelector("#saveButton").addEventListener("click", () => {
    if (state.saved.has(job.id)) {
      state.saved.delete(job.id);
    } else {
      state.saved.add(job.id);
    }
    persistSavedJobs();
    renderJobPost({ ...job, match });
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

function setAuthMode(mode) {
  const isRegister = mode === "register";
  elements.loginForm.hidden = isRegister;
  elements.registerForm.hidden = !isRegister;
  elements.loginTab.classList.toggle("active", !isRegister);
  elements.registerTab.classList.toggle("active", isRegister);
  elements.authMessage.textContent = "";
}

function formPreferencesFromRegister(user) {
  return {
    full_name: elements.registerName.value.trim() || user.email,
    country: elements.registerCountry.value,
    region: elements.registerRegion.value.trim(),
    keywords: parseList(elements.registerKeywords.value),
    companies: parseList(elements.registerCompanies.value),
  };
}

function formPreferencesFromDashboard() {
  return {
    full_name: state.preferences?.full_name || state.session?.user?.email || "",
    country: elements.countryInput.value,
    region: elements.regionInput.value.trim(),
    keywords: parseList(elements.keywordsInput.value),
    companies: parseList(elements.companiesInput.value),
  };
}

function validatePreferences(values) {
  if (!values.country) {
    throw new Error("Choose a country for your radar.");
  }
  if (!values.keywords.length) {
    throw new Error("Add at least one keyword.");
  }
  if (!values.companies.length) {
    throw new Error("Add at least one company.");
  }
}

function setLoading(isLoading) {
  if (!elements.refreshButton) {
    return;
  }
  elements.refreshButton.disabled = isLoading;
  elements.refreshButton.style.opacity = isLoading ? "0.55" : "1";
}

function renderError(error) {
  elements.jobList.innerHTML = "";
  elements.emptyState.hidden = true;
  elements.detailsContent.innerHTML = `
    <p class="eyebrow">Connection</p>
    <h2>NeoHunt could not load your radar.</h2>
    <p class="error-state">${escapeHtml(error.message)}</p>
  `;
}

function renderDetailError(error) {
  elements.jobPost.innerHTML = `
    <p class="eyebrow">NeoHunt</p>
    <h2>This job is not available.</h2>
    <p class="error-state">${escapeHtml(error.message)}</p>
    <div class="actions">
      <a class="secondary-action" href="./">Back to feed</a>
    </div>
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

if (isDetailPage) {
  loadDetailPage();
} else {
  elements.loginTab.addEventListener("click", () => setAuthMode("login"));
  elements.registerTab.addEventListener("click", () => setAuthMode("register"));
  elements.refreshButton.addEventListener("click", loadListPage);
  elements.searchInput.addEventListener("input", renderList);
  elements.scoreFilter.addEventListener("change", renderList);
  elements.signOutButton.addEventListener("click", async () => {
    await getClient().auth.signOut();
    state.session = null;
    state.preferences = null;
    state.jobs = [];
    state.saved = new Set();
    showAuth();
  });

  elements.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    elements.authMessage.textContent = "Checking your account...";
    try {
      const { data, error } = await getClient().auth.signInWithPassword({
        email: elements.loginEmail.value.trim(),
        password: elements.loginPassword.value,
      });
      if (error) {
        throw error;
      }
      state.session = data.session;
      await applyPendingPreferences(data.user);
      elements.authMessage.textContent = "";
      await loadListPage();
    } catch (error) {
      elements.authMessage.textContent = error.message;
    }
  });

  elements.registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    elements.authMessage.textContent = "Creating your radar...";
    try {
      const registerEmail = elements.registerEmail.value.trim();
      const draftUser = {
        id: "pending",
        email: registerEmail,
        user_metadata: { full_name: elements.registerName.value.trim() },
      };
      const values = formPreferencesFromRegister(draftUser);
      validatePreferences(values);

      const { data, error } = await getClient().auth.signUp({
        email: registerEmail,
        password: elements.registerPassword.value,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            full_name: elements.registerName.value.trim(),
          },
        },
      });
      if (error) {
        throw error;
      }
      if (!data.session) {
        writePendingPreferences(registerEmail, values);
        elements.authMessage.textContent = "Account created. Confirm your email, then login to open your radar.";
        return;
      }
      state.session = data.session;
      await savePreferences(values);
      elements.authMessage.textContent = "";
      await loadListPage();
    } catch (error) {
      elements.authMessage.textContent = error.message;
    }
  });

  elements.preferencesForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    elements.preferencesMessage.textContent = "Saving...";
    try {
      const values = formPreferencesFromDashboard();
      validatePreferences(values);
      await savePreferences(values);
      renderPreferenceForm();
      renderList();
      elements.preferencesMessage.textContent = "Radar updated.";
    } catch (error) {
      elements.preferencesMessage.textContent = error.message;
    }
  });

  bootHome().catch((error) => {
    elements.authMessage.textContent = error.message;
    showAuth();
  });
}
