const form = document.getElementById('search-form');
const statusText = document.getElementById('status');
const resultsTable = document.getElementById('results-table');
const resultsBody = document.getElementById('results-body');
const signOutButton = document.getElementById('signOutButton');
const exportSection = document.getElementById('export-section');
const exportButton = document.getElementById('exportButton');
const fetchLabelsButton = document.getElementById('fetchLabelsButton');
const labelSelects = document.querySelectorAll('.label-select');
const clearLabelButtons = document.querySelectorAll('.clear-label-button');
const labelFetchStatus = document.getElementById('labelFetchStatus');
const filterInputs = document.querySelectorAll('.filter-input');
const importIssuesForm = document.getElementById('importIssuesForm');
const importTokenInput = document.getElementById('importToken');
const importSignOutButton = document.getElementById('importSignOutButton');
const targetIssuesApiUrlInput = document.getElementById('targetIssuesApiUrl');
const importSourceFolderInput = document.getElementById('importSourceFolder');
const importSpeedSelect = document.getElementById('importSpeed');
const importIssuesButton = document.getElementById('importIssuesButton');
const importValidationWarning = document.getElementById('importValidationWarning');
const importStatus = document.getElementById('importStatus');
const importReport = document.getElementById('importReport');
const importBrowserMessages = document.getElementById('importBrowserMessages');
const downloadImportReportButton = document.getElementById('downloadImportReportButton');

const reportTargetRepoConnection = document.getElementById('reportTargetRepoConnection');
const reportIssuesAttempted = document.getElementById('reportIssuesAttempted');
const reportIssuesSucceeded = document.getElementById('reportIssuesSucceeded');
const reportIssuesFailed = document.getElementById('reportIssuesFailed');
const reportMediaAttempted = document.getElementById('reportMediaAttempted');
const reportMediaSucceeded = document.getElementById('reportMediaSucceeded');
const reportMediaFailed = document.getElementById('reportMediaFailed');

let latestImportReport = null;

let allRepoLabels = [];

let currentIssues = [];
let currentToken = '';
let currentOwner = '';
let currentRepo = '';
let currentStateFilter = 'open';
let currentIncludeLabelsAll = [];
let currentIncludeLabelsAny = [];
let currentExcludeLabelsAny = [];
let currentExcludeLabelsAll = [];

const AUTH_ERROR_MESSAGE =
  'Results could not be fetched because the user is either not logged in or does not have sufficient privileges for the repo they wish to query.';

const IMPORT_TOKEN_STORAGE_KEY = 'githubIssueImporterToken';
const IMPORT_SPEED_STORAGE_KEY = 'githubIssueImporterSpeed';
const DEFAULT_IMPORT_SPEED = 'normal';
const IMPORT_SPEED_CONFIG = {
  slow: {
    label: 'Slow',
    requestDelayMs: 2500,
    maxRetryAttempts: 8,
  },
  normal: {
    label: 'Normal',
    requestDelayMs: 1200,
    maxRetryAttempts: 6,
  },
  fast: {
    label: 'Fast',
    requestDelayMs: 500,
    maxRetryAttempts: 4,
  },
};

const parseLabels = (inputElement) => {
  if (!inputElement) return [];
  
  if (inputElement.tagName === 'SELECT') {
    return Array.from(inputElement.selectedOptions).map(option => option.value.toLowerCase());
  }
  
  return inputElement.value
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
};

const formatDate = (isoDate) =>
  new Date(isoDate).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

const escapeHtml = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const buildHeaders = (token) => ({
  Accept: 'application/vnd.github.v3+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
});

const updateSignOutButtonState = () => {
  signOutButton.disabled = !form.token.value.trim();
};

const updateImportSignOutButtonState = () => {
  if (!importSignOutButton || !importTokenInput) return;
  importSignOutButton.disabled = !importTokenInput.value.trim();
};

const updateFetchLabelsButtonState = () => {
  const token = form.token.value.trim();
  const owner = form.owner.value.trim();
  const repo = form.repo.value.trim();
  fetchLabelsButton.disabled = !token || !owner || !repo;
};

const ensureAuthenticatedUser = async (token) => {
  const response = await fetch('https://api.github.com/user', {
    headers: buildHeaders(token),
  });

  if (!response.ok) {
    throw new Error(AUTH_ERROR_MESSAGE);
  }
};

const fetchAllOpenIssues = async (owner, repo, token, state = 'open') => {
  const collected = [];
  const stateParam = state || 'open';
  let url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=${encodeURIComponent(stateParam)}&per_page=100`;

  while (url) {
    console.log('Fetching issues with URL:', url);
    
    const response = await fetch(url, {
      headers: buildHeaders(token),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('GitHub API error:', response.status, errorBody);
      
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        throw new Error(AUTH_ERROR_MESSAGE);
      }
      throw new Error(`GitHub API error: ${response.status} - ${errorBody}`);
    }

    const data = await response.json();
    const issuesOnly = data.filter((item) => !item.pull_request);
    collected.push(...issuesOnly);

    // Handle pagination using Link header
    const linkHeader = response.headers.get('link');
    if (linkHeader) {
      const nextLink = linkHeader.split(',').find(s => s.includes('rel="next"'));
      if (nextLink) {
        const match = nextLink.match(/<([^>]+)>/);
        url = match ? match[1] : null;
      } else {
        url = null;
      }
    } else {
      url = null;
    }
  }

  return collected;
};

const filterByLabels = (issues, includeLabelsAll, includeLabelsAny, excludeLabelsAny, excludeLabelsAll) =>
  issues.filter((issue) => {
    const issueLabels = issue.labels.map((label) => label.name.toLowerCase());

    // Include Logic: ALL specified labels must be present (AND)
    const matchesIncludeAll = includeLabelsAll.length === 0 ||
      includeLabelsAll.every((label) => issueLabels.includes(label));

    // Include Logic: At least ONE specified label must be present (OR)
    const matchesIncludeAny = includeLabelsAny.length === 0 ||
      includeLabelsAny.some((label) => issueLabels.includes(label));

    // Exclude Logic: If ANY specified label is present, exclude (OR)
    const hasAnyExcluded = excludeLabelsAny.length > 0 &&
      excludeLabelsAny.some((label) => issueLabels.includes(label));

    // Exclude Logic: Only if ALL specified labels are present, exclude (AND)
    const hasAllExcluded = excludeLabelsAll.length > 0 &&
      excludeLabelsAll.every((label) => issueLabels.includes(label));

    return matchesIncludeAll && matchesIncludeAny && !hasAnyExcluded && !hasAllExcluded;
  });

const renderRows = (issues) => {
  if (!issues.length) {
    resultsBody.innerHTML = '';
    resultsTable.hidden = true;
    return;
  }

  resultsBody.innerHTML = issues
    .map((issue) => {
      const labels = issue.labels.map((label) => label.name);
      const labelChips = labels.length
        ? labels
            .map((labelName) => `<span class="label-chip">${escapeHtml(labelName)}</span>`)
            .join('')
        : '<span>None</span>';

      return `
        <tr>
          <td>${issue.number}</td>
          <td>${escapeHtml(issue.title)}</td>
          <td>${formatDate(issue.created_at)}</td>
          <td><div class="label-list">${labelChips}</div></td>
          <td><a href="${issue.html_url}" target="_blank" rel="noopener noreferrer">Open Issue #${issue.number}</a></td>
        </tr>
      `;
    })
    .join('');

  resultsTable.hidden = false;
};


const fetchRepoLabels = async (owner, repo, token) => {
  const labels = [];
  let page = 1;
  
  while (true) {
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels?per_page=100&page=${page}`;
    const response = await fetch(url, { headers: buildHeaders(token) });
    
    if (!response.ok) {
      if (response.status === 404) throw new Error('Repository not found.');
      if (response.status === 401) throw new Error('Unauthorized or invalid token.');
      throw new Error(`Failed to fetch labels: ${response.status}`);
    }
    
    const data = await response.json();
    labels.push(...data);
    
    if (data.length < 100) break;
    page++;
  }
  return labels.sort((a,b) => a.name.localeCompare(b.name));
};


const updateLabelDropdowns = (labels, searchTerm = '', targetSelectId = null) => {
  if (targetSelectId) {
    const select = document.getElementById(targetSelectId);
    if (select) {
        renderFilteredOptions(select, labels, searchTerm);
    }
  } else {
    // Initial load: update all selects
    labelSelects.forEach(select => {
        renderFilteredOptions(select, labels, '');
    });
  }
};

const renderFilteredOptions = (select, labels, searchTerm) => {
    // 1. Capture current selection (values)
    const currentSelectedValues = new Set(Array.from(select.selectedOptions).map(o => o.value));

    // 2. Clear options
    select.innerHTML = '';
    
    // 3. Filter labels
    const normalizedTerm = searchTerm.toLowerCase();
    const filteredLabels = labels.filter(l => l.name.toLowerCase().includes(normalizedTerm));
    const visibleNames = new Set(filteredLabels.map(l => l.name));

    // 4. Render matching labels
    filteredLabels.forEach(label => {
        const option = createLabelOption(label);
        if (currentSelectedValues.has(label.name)) {
            option.selected = true;
        }
        select.appendChild(option);
    });

    // 5. If we have a filter active, ensure SELECTED items that are hidden get added back
    if (normalizedTerm) {
        const hiddenSelected = labels.filter(l => currentSelectedValues.has(l.name) && !visibleNames.has(l.name));
        
        if (hiddenSelected.length > 0) {
            const separator = document.createElement('option');
            separator.textContent = '--- Selected (Hidden by filter) ---';
            separator.disabled = true;
            select.appendChild(separator);
            
            hiddenSelected.forEach(label => {
                const option = createLabelOption(label);
                option.selected = true;
                select.appendChild(option);
            });
        }
    }
};

const createLabelOption = (label) => {
    const option = document.createElement('option');
    option.value = label.name;
    option.textContent = label.name;
    option.style.borderLeft = `5px solid #${label.color}`;
    option.style.paddingLeft = '5px';
    return option;
};

fetchLabelsButton.addEventListener('click', async () => {
  const token = form.token.value.trim();
  const owner = form.owner.value.trim();
  const repo = form.repo.value.trim();
  
  if (!token || !owner || !repo) {
    alert('Please provide Token, Owner, and Repo Name to fetch labels.');
    return;
  }
  
  fetchLabelsButton.disabled = true;
  labelFetchStatus.textContent = 'Loading...';
  
  try {
    const labels = await fetchRepoLabels(owner, repo, token);
    allRepoLabels = labels; // Store for filtering
    
    // Reset all filters
    filterInputs.forEach(input => input.value = '');
    
    labelSelects.forEach(select => {
        renderFilteredOptions(select, labels, '');
    });
    
    labelFetchStatus.textContent = `Loaded ${labels.length} labels.`;
    labelFetchStatus.className = 'status-success';
  } catch (error) {
    labelFetchStatus.textContent = `Error: ${error.message}`;
    labelFetchStatus.className = 'status-error';
  } finally {
    fetchLabelsButton.disabled = false;
  }
});

// Add event listeners for filter inputs
filterInputs.forEach(input => {
    input.addEventListener('input', (e) => {
        const searchTerm = e.target.value;
        const targetSelectId = e.target.getAttribute('data-target');
        if (allRepoLabels.length > 0) {
            updateLabelDropdowns(allRepoLabels, searchTerm, targetSelectId);
        }
    });
});

clearLabelButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const targetSelectId = button.getAttribute('data-target');
    const select = document.getElementById(targetSelectId);
    if (!select) return;

    Array.from(select.options).forEach((option) => {
      option.selected = false;
    });

    if (allRepoLabels.length > 0) {
      const filterInput = document.querySelector(`.filter-input[data-target="${targetSelectId}"]`);
      const searchTerm = filterInput ? filterInput.value : '';
      updateLabelDropdowns(allRepoLabels, searchTerm, targetSelectId);
    }
  });
});

labelSelects.forEach((select) => {
  select.addEventListener('mousedown', (event) => {
    const option = event.target;
    if (!(option instanceof HTMLOptionElement)) return;

    if (event.ctrlKey || event.metaKey || event.shiftKey) return;

    event.preventDefault();
    option.selected = !option.selected;
    select.focus();
  });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const token = form.token.value.trim();
  const owner = form.owner.value.trim();
  const repo = form.repo.value.trim();
  const stateFilter = form.stateFilter.value || 'open';
  console.log('Form submitted with state filter:', stateFilter, 'type:', typeof stateFilter);
  const includeLabelsAll = parseLabels(form.includeLabelsAll);
  const includeLabelsAny = parseLabels(form.includeLabelsAny);
  const excludeLabelsAny = parseLabels(form.excludeLabelsAny);
  const excludeLabelsAll = parseLabels(form.excludeLabelsAll);

  const submitButton = form.querySelector('button[type="submit"]');

  statusText.innerHTML = `Loading ${stateFilter} issues... <br> Load times may vary based on number of issues identified and limitations on API calls to repo.`;
  submitButton.disabled = true;
  resultsTable.hidden = true;

  try {
    await ensureAuthenticatedUser(token);
    localStorage.setItem('githubIssueExporterToken', token);
    updateSignOutButtonState();

    const openIssues = await fetchAllOpenIssues(owner, repo, token, stateFilter);
    const filteredIssues = filterByLabels(openIssues, includeLabelsAll, includeLabelsAny, excludeLabelsAny, excludeLabelsAll);

    currentIssues = filteredIssues;
    currentToken = token;
    currentOwner = owner;
    currentRepo = repo;
    currentStateFilter = stateFilter;
    currentIncludeLabelsAll = includeLabelsAll;
    currentIncludeLabelsAny = includeLabelsAny;
    currentExcludeLabelsAny = excludeLabelsAny;
    currentExcludeLabelsAll = excludeLabelsAll;

    renderRows(filteredIssues);
    const stateLabel = stateFilter + ' ';
    statusText.textContent = `Found ${filteredIssues.length} ${stateLabel}issue(s).`;
    exportSection.hidden = filteredIssues.length === 0;
  } catch (error) {
    resultsBody.innerHTML = '';
    resultsTable.hidden = true;
    exportSection.hidden = true;
    statusText.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

const storedToken = localStorage.getItem('githubIssueExporterToken');
if (storedToken) {
  form.token.value = storedToken;
}

updateSignOutButtonState();
updateFetchLabelsButtonState();

form.token.addEventListener('input', () => {
  updateSignOutButtonState();
  updateFetchLabelsButtonState();
});

form.owner.addEventListener('input', () => {
  updateFetchLabelsButtonState();
});

form.repo.addEventListener('input', () => {
  updateFetchLabelsButtonState();
});

signOutButton.addEventListener('click', () => {
  localStorage.removeItem('githubIssueExporterToken');
  form.token.value = '';
  updateSignOutButtonState();
  statusText.textContent = 'Signed out. Enter a GitHub access token to search issues.';
  resultsBody.innerHTML = '';
  resultsTable.hidden = true;
  exportSection.hidden = true;
  currentIssues = [];
});

// Export Functionality
const fetchIssueComments = async (owner, repo, issueNumber, token) => {
  const comments = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
      { headers: buildHeaders(token) }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch comments for issue #${issueNumber}`);
    }

    const data = await response.json();
    comments.push(...data);

    if (data.length < 100) break;
    page += 1;
  }

  return comments;
};

const isLikelyMediaUrl = (url) => {
  if (!url) return false;

  const extensionPattern = /\.(?:jpg|jpeg|png|gif|webp|svg|mp4|webm|mov|avi)(?:[?#].*)?$/i;
  if (extensionPattern.test(url)) return true;

  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname.toLowerCase();
    const path = parsedUrl.pathname.toLowerCase();

    if (host === 'github.com' && path.includes('/user-attachments/assets/')) return true;
    if (host.endsWith('githubusercontent.com') && (path.includes('/user-images/') || path.includes('/assets/'))) return true;
  } catch {
    return false;
  }

  return false;
};

const decodeHtmlEntities = (value) => {
  if (!value) return value;
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
};

const normalizeMediaUrl = (url) => {
  const decodedUrl = decodeHtmlEntities((url || '').trim());
  if (!decodedUrl) return '';

  try {
    const parsed = new URL(decodedUrl);
    // Normalize host casing and remove trailing punctuation often captured in markdown text
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = parsed.hash;
    return parsed.toString().replace(/[),.;]+$/, '');
  } catch {
    return decodedUrl.replace(/[),.;]+$/, '');
  }
};

const buildDownloadCandidates = (url) => {
  const candidates = [url];

  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname;

    if (host === 'github.com' && pathname.includes('/user-attachments/assets/')) {
      const withRaw = new URL(parsedUrl.toString());
      withRaw.searchParams.set('raw', '1');
      candidates.push(withRaw.toString());

      const withDownload = new URL(parsedUrl.toString());
      withDownload.searchParams.set('download', '1');
      candidates.push(withDownload.toString());
    }

    if (host === 'github.com' && pathname.includes('/blob/')) {
      const parts = pathname.split('/').filter(Boolean);
      // /owner/repo/blob/branch/path/to/file
      if (parts.length >= 5) {
        const owner = parts[0];
        const repo = parts[1];
        const branch = parts[3];
        const filePath = parts.slice(4).join('/');
        candidates.push(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`);
      }
    }
  } catch {
    return [...new Set(candidates)];
  }

  return [...new Set(candidates)];
};

const downloadMediaAsBlob = async (url, token) => {
  try {
    // Skip data URLs (already embedded)
    if (url.startsWith('data:')) return null;
    
    // Skip relative URLs and invalid URLs
    try {
      new URL(url);
    } catch {
      return null;
    }
    
    const candidates = buildDownloadCandidates(url);
    for (const candidate of candidates) {
      try {
        const parsedUrl = new URL(candidate);
        const isGitHubApi = parsedUrl.hostname === 'api.github.com';

        const response = await fetch(candidate, {
          mode: 'cors',
          cache: 'default',
          headers: isGitHubApi && token
            ? {
                ...buildHeaders(token),
                Accept: '*/*',
              }
            : undefined,
        });

        if (response.ok) {
          const blob = await response.blob();
          if (blob && blob.size > 0) {
            return blob;
          }
        }
      } catch {
        // Continue to next candidate
      }
    }

    return null;
  } catch (error) {
    // CORS or network error - return null
    console.warn(`Failed to download media: ${url}`, error);
    return null;
  }
};

const extractMediaUrls = (content, isHtml = false) => {
  const urls = [];
  
  if (!content) return urls;
  
  let match;
  
  if (!isHtml) {
    // Extract from Markdown: ![alt](url)
    const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    while ((match = imgRegex.exec(content))) {
      urls.push({ type: 'image', url: normalizeMediaUrl(match[2]), alt: match[1] });
    }

    // Extract markdown links that point to media: [text](url)
    const markdownLinkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
    while ((match = markdownLinkRegex.exec(content))) {
      const candidateUrl = normalizeMediaUrl(match[2]);
      if (isLikelyMediaUrl(candidateUrl)) {
        urls.push({ type: 'media', url: candidateUrl, alt: match[1] });
      }
    }
  }
  
  // Extract from HTML tags (works for both markdown with HTML and pure HTML)
  // Images: <img src="..." /> or <img src='...' />
  const imgSrcRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  while ((match = imgSrcRegex.exec(content))) {
    urls.push({ type: 'image', url: normalizeMediaUrl(match[1]), alt: '' });
  }
  
  // Videos: <video src="..." />
  const videoSrcRegex = /<video[^>]+src=["']([^"']+)["'][^>]*>/gi;
  while ((match = videoSrcRegex.exec(content))) {
    urls.push({ type: 'video', url: normalizeMediaUrl(match[1]), alt: '' });
  }
  
  // Source tags inside video: <source src="..." />
  const sourceSrcRegex = /<source[^>]+src=["']([^"']+)["'][^>]*>/gi;
  while ((match = sourceSrcRegex.exec(content))) {
    urls.push({ type: 'video', url: normalizeMediaUrl(match[1]), alt: '' });
  }

  // Links to media files or GitHub attachments: <a href="...">
  const anchorHrefRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  while ((match = anchorHrefRegex.exec(content))) {
    const href = normalizeMediaUrl(match[1]);
    if (isLikelyMediaUrl(href)) {
      urls.push({ type: 'media', url: href, alt: '' });
    }
  }
  
  // srcset attributes (responsive images)
  const srcsetRegex = /srcset=["']([^"']+)["']/gi;
  while ((match = srcsetRegex.exec(content))) {
    // srcset can have multiple URLs separated by commas with descriptors
    const srcsetUrls = match[1].split(',').map(s => s.trim().split(/\s+/)[0]);
    srcsetUrls.forEach(url => {
      if (url) urls.push({ type: 'image', url: normalizeMediaUrl(url), alt: '' });
    });
  }
  
  // Direct links to common image/video formats
  const directMediaRegex = /https?:\/\/[^\s<>"]+\.(?:jpg|jpeg|png|gif|webp|svg|mp4|webm|mov|avi)(?:[?#][^\s<>"]*)?/gi;
  while ((match = directMediaRegex.exec(content))) {
    urls.push({ type: 'media', url: normalizeMediaUrl(match[0]), alt: '' });
  }

  // GitHub user-attachment links that often do not include file extensions
  const githubAttachmentRegex = /https?:\/\/github\.com\/user-attachments\/assets\/[a-z0-9-]+/gi;
  while ((match = githubAttachmentRegex.exec(content))) {
    urls.push({ type: 'media', url: normalizeMediaUrl(match[0]), alt: '' });
  }

  return urls;
};

const replaceMediaWithLocalPaths = async (content, mediaMap) => {
  if (!content) return content;
  
  let result = content;

  for (const [url, localPath] of Object.entries(mediaMap)) {
    if (localPath && url !== localPath) {
      // Use split/join to avoid regex escaping issues
      result = result.split(url).join(localPath);
      result = result.split(url.replaceAll('&', '&amp;')).join(localPath);
    }
  }

  return result;
};

const failedMediaFallbackMessage =
  'Media files failed to be fetched. Contact the person who provided you with this file if you need screenshots or screen recordings for added issue context.';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const replaceFailedMediaWithMessage = async (content, failedUrls) => {
  if (!content || !failedUrls || failedUrls.length === 0) return content;

  let result = content;
  const fallbackDiv = `<div style="border: 3px solid #000; background-color: #e9b833; color: #000; padding: 0.75rem; margin: 0.75rem 0;">${escapeHtml(failedMediaFallbackMessage)}</div>`;

  for (const originalUrl of failedUrls) {
    const normalizedUrl = normalizeMediaUrl(originalUrl);
    if (!normalizedUrl) continue;

    const urlVariants = [normalizedUrl, normalizedUrl.replaceAll('&', '&amp;')];

    for (const urlVariant of urlVariants) {
      const escapedUrl = escapeRegex(urlVariant);

      result = result.replace(new RegExp(`<img[^>]*src=["']${escapedUrl}["'][^>]*>`, 'gi'), fallbackDiv);
      result = result.replace(new RegExp(`<video[^>]*src=["']${escapedUrl}["'][^>]*>[\\s\\S]*?<\\/video>`, 'gi'), fallbackDiv);
      result = result.replace(new RegExp(`<source[^>]*src=["']${escapedUrl}["'][^>]*>`, 'gi'), fallbackDiv);
      result = result.replace(new RegExp(`<a[^>]*href=["']${escapedUrl}["'][^>]*>[\\s\\S]*?<\\/a>`, 'gi'), fallbackDiv);
    }
  }

  return result;
};

const generateOfflineSiteCSS = () => `
:root {
  font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif;
  color: #24292f;
  background: #f6f8fa;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 2rem 1rem;
  line-height: 1.6;
}

.container {
  max-width: 1100px;
  margin: 0 auto;
  background: #ffffff;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

h1 {
  margin-top: 0;
  color: #0969da;
}

.back-link {
  display: inline-block;
  margin-bottom: 1rem;
  color: #0969da;
  text-decoration: none;
}

.back-link:hover {
  text-decoration: underline;
}

.issue-meta {
  color: #57606a;
  margin: 1rem 0;
  font-size: 0.95rem;
}

.label-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 1rem 0;
}

.label-chip {
  border-radius: 999px;
  background: #ddf4ff;
  border: 1px solid #0d1d48;
  color: #0d1d48;
  font-size: 0.85rem;
  padding: 0.2rem 0.6rem;
  font-weight: 500;
}

.collapsible {
  background: #f6f8fa;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  margin: 1.5rem 0;
}

.collapsible-header {
  padding: 0.75rem 1rem;
  cursor: pointer;
  font-weight: 600;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.collapsible-header:hover {
  background: #eaeef2;
}

.collapsible-content {
  padding: 1rem;
  border-top: 1px solid #d0d7de;
}

.collapsible-content.collapsed {
  display: none;
}

.issue-body, .comment-body {
  padding: 1rem;
  background: #ffffff;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  margin: 1rem 0;
}

.comment {
  margin-bottom: 1.5rem;
  border: 1px solid #d0d7de;
  border-radius: 6px;
}

.comment-header {
  background: #f6f8fa;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #d0d7de;
  font-size: 0.9rem;
  color: #57606a;
}

.comment-body {
  border: none;
  margin: 0;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
}

th, td {
  text-align: left;
  padding: 0.75rem;
  border-bottom: 1px solid #d0d7de;
}

th {
  background: #f6f8fa;
  font-weight: 600;
}

tr:hover {
  background: #f6f8fa;
}

a {
  color: #0969da;
}

a:hover {
  text-decoration: underline;
}

img, video {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}

pre {
  background: #f6f8fa;
  padding: 1rem;
  border-radius: 6px;
  overflow-x: auto;
}

code {
  background: #f6f8fa;
  padding: 0.2rem 0.4rem;
  border-radius: 3px;
  font-size: 0.9em;
}

pre code {
  background: none;
  padding: 0;
}
`;

const generateIndexHTML = (issues, owner, repo, filters) => {
  const issuesRows = issues
    .map((issue) => {
      const labels = issue.labels.map((label) => label.name);
      const labelChips = labels.length
        ? labels.map((labelName) => `<span class="label-chip">${escapeHtml(labelName)}</span>`).join('')
        : '<span>None</span>';

      return `
        <tr>
          <td>${issue.number}</td>
          <td><a href="issue-${issue.number}.html">${escapeHtml(issue.title)}</a></td>
          <td>${formatDate(issue.created_at)}</td>
          <td><div class="label-list">${labelChips}</div></td>
          <td><a href="${issue.html_url}" target="_blank" rel="noopener">Original Issue</a></td>
        </tr>
      `;
    })
    .join('');

  const filterItems = [
    `<li><strong>State Filter:</strong> ${escapeHtml(filters.state)}</li>`,
    filters.includeAll.length ? `<li><strong>Include All Labels:</strong> ${filters.includeAll.map(l => `<span class="label-chip">${escapeHtml(l)}</span>`).join(' ')}</li>` : '',
    filters.includeAny.length ? `<li><strong>Include Any Labels:</strong> ${filters.includeAny.map(l => `<span class="label-chip">${escapeHtml(l)}</span>`).join(' ')}</li>` : '',
    filters.excludeAny.length ? `<li><strong>Exclude Any Labels:</strong> ${filters.excludeAny.map(l => `<span class="label-chip">${escapeHtml(l)}</span>`).join(' ')}</li>` : '',
    filters.excludeAll.length ? `<li><strong>Exclude All Labels:</strong> ${filters.excludeAll.map(l => `<span class="label-chip">${escapeHtml(l)}</span>`).join(' ')}</li>` : ''
  ].filter(Boolean).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GitHub Issues - ${escapeHtml(owner)}/${escapeHtml(repo)}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="container">
    <head>
      <h1>GitHub Issues: ${escapeHtml(owner)}/${escapeHtml(repo)}</h1>
      <p>Exported on ${new Date().toLocaleString()}</p>
    </head>  
    <main>
      <section aria-labelledby="appliedFiltersSection">
        <div class="issue-filters">
          <h2 id="appliedFiltersSection">Issue Filters Applied</h2>
          <ul>
            ${filterItems}
          </ul>
        </div>
      </section>
      <section aria-labelledby="issueListSection">
        <h2 id="issueListSection">Issue List</h2>
        <p>Clicking on an issue's title will take you to a detailed view of the issue at the time it was exported, including its description and comments, all available offline.</p>
        <p>In the event that any content within the issue does not load, or is inaccessible offline, contact whomever you sourced the export from for additional details.</p>
        <p><strong>${issues.length}</strong> issue(s) found</p>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Created Date</th>
              <th>Labels on Issue</th>
              <th>Original GitHub URL</th>
            </tr>
          </thead>
          <tbody>
            ${issuesRows}
          </tbody>
        </table>
      </section>
    </main>
  </div>
</body>
</html>`;
};

const generateIssueHTML = (issue, comments, owner, repo) => {
  const labels = issue.labels.map((label) => label.name);
  const labelChips = labels.length
    ? labels.map((labelName) => `<span class="label-chip">${escapeHtml(labelName)}</span>`).join('')
    : '<span>None</span>';

  const commentsHTML = comments.length
    ? comments
        .map(
          (comment) => `
        <div class="comment">
          <div class="comment-header">
            <strong>${escapeHtml(comment.user?.login || 'Unknown')}</strong> commented on ${formatDate(comment.created_at)}
          </div>
          <div class="comment-body">
            ${comment.body_html || escapeHtml(comment.body || '')}
          </div>
        </div>
      `
        )
        .join('')
    : '<p>No comments</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Issue #${issue.number}: ${escapeHtml(issue.title)}</title>
  <link rel="stylesheet" href="styles.css">
  <script>
    function toggleCollapsible(element) {
      const content = element.nextElementSibling;
      content.classList.toggle('collapsed');
      const arrow = element.querySelector('.arrow');
      arrow.textContent = content.classList.contains('collapsed') ? '▶' : '▼';
    }
  </script>
</head>
<body>
  <div class="container">
    <a href="index.html" class="back-link">← Back to Issues List</a>
    
    <h1>#${issue.number}: ${escapeHtml(issue.title)}</h1>
    
    <div class="issue-meta">
      <strong>ID:</strong> ${issue.number}<br>
      <strong>Created:</strong> ${formatDate(issue.created_at)}<br>
      <strong>Author:</strong> ${escapeHtml(issue.user?.login || 'Unknown')}<br>
      <strong>State:</strong> ${escapeHtml(issue.state)}<br>
      <strong>Original:</strong> <a href="${issue.html_url}" target="_blank">${issue.html_url}</a>
    </div>
    
    <div class="collapsible">
      <div class="collapsible-header" onclick="toggleCollapsible(this)">
        <span>Labels</span>
        <span class="arrow">▼</span>
      </div>
      <div class="collapsible-content">
        <div class="label-list">${labelChips}</div>
      </div>
    </div>
    
    <h2>Description</h2>
    <div class="issue-body">
      ${issue.body_html || escapeHtml(issue.body || 'No description provided.')}
    </div>
    
    <div class="collapsible">
      <div class="collapsible-header" onclick="toggleCollapsible(this)">
        <span>Comments (${comments.length})</span>
        <span class="arrow">▼</span>
      </div>
      <div class="collapsible-content">
        ${commentsHTML}
      </div>
    </div>
  </div>
</body>
</html>`;
};

exportButton.addEventListener('click', async () => {
  if (!currentIssues.length) return;

  exportButton.disabled = true;
  statusText.textContent = 'Preparing export...';

  try {
    const zip = new JSZip();
    const mediaMap = {};

    // Fetch full issue details with HTML bodies
    const issuesWithComments = await fetchIssuesWithDetails();
    
    // Generate files
    statusText.textContent = 'Generating HTML files...';

    const assetsFolder = zip.folder("assets");
    
    // Extract and download media
    const mediaDownloadResults = await extractAndDownloadMedia(issuesWithComments, mediaMap, assetsFolder);
    
    // Replace media URLs with local paths
    await replaceMediaWithLocalPathsInIssues(issuesWithComments, mediaMap, mediaDownloadResults.failedUrls);

    zip.file('styles.css', generateOfflineSiteCSS());
    zip.file('index.html', generateIndexHTML(issuesWithComments, currentOwner, currentRepo, {
      state: currentStateFilter,
      includeAll: currentIncludeLabelsAll,
      includeAny: currentIncludeLabelsAny,
      excludeAny: currentExcludeLabelsAny,
      excludeAll: currentExcludeLabelsAll
    }));

    issuesWithComments.forEach((issue) => {
      const html = generateIssueHTML(issue, issue.comments, currentOwner, currentRepo);
      zip.file(`issue-${issue.number}.html`, html);
    });

    const reportLines = [
      'GitHub Issue Exporter - Media Download Report',
      `Repository: ${currentOwner}/${currentRepo}`,
      `Exported: ${new Date().toLocaleString()}`,
      '',
      `Media URLs discovered: ${mediaDownloadResults.uniqueUrls.length}`,
      `Media assets downloaded: ${mediaDownloadResults.downloadedUrls.length}`,
      `Media URLs failed: ${mediaDownloadResults.failedUrls.length}`,
      '',
      'Failed media URLs:',
      ...(mediaDownloadResults.failedUrls.length
        ? mediaDownloadResults.failedUrls.map((url) => `- ${url}`)
        : ['- None'])
    ];
    zip.file('media-download-report.txt', reportLines.join('\n'));

    // Generate and download zip
    statusText.textContent = 'Creating archive...';
    const blob = await zip.generateAsync({ type: 'blob' });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${currentOwner}-${currentRepo}-issues-${Date.now()}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);

    statusText.textContent = `Export complete! Downloaded ${issuesWithComments.length} issue(s), ${mediaDownloadResults.downloadedUrls.length} media asset(s), ${mediaDownloadResults.failedUrls.length} media URL(s) failed (see media-download-report.txt).`;
  } catch (error) {
    statusText.textContent = `Export failed: ${error.message}`;
  } finally {
    exportButton.disabled = false;
  }
});

// Helper functions for exports
async function fetchIssuesWithDetails() {
  statusText.textContent = `Fetching details for ${currentIssues.length} issue(s)...`;

  const detailedIssues = await Promise.all(
    currentIssues.map(async (issue) => {
      const response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(currentOwner)}/${encodeURIComponent(currentRepo)}/issues/${issue.number}`,
        {
          headers: {
            ...buildHeaders(currentToken),
            Accept: 'application/vnd.github.html+json',
          },
        }
      );

      if (!response.ok) return issue;
      return await response.json();
    })
  );

  statusText.textContent = 'Fetching comments...';
  return await Promise.all(
    detailedIssues.map(async (issue) => {
      const comments = await fetchIssueComments(currentOwner, currentRepo, issue.number, currentToken);

      // Fetch HTML version of comments
      const commentsWithHtml = await Promise.all(
        comments.map(async (comment) => {
          const response = await fetch(comment.url, {
            headers: {
              ...buildHeaders(currentToken),
              Accept: 'application/vnd.github.html+json',
            },
          });

          if (!response.ok) return comment;
          return await response.json();
        })
      );

      return { ...issue, comments: commentsWithHtml };
    })
  );
}

async function extractAndDownloadMedia(issues, mediaMap, assetsFolder) {
  statusText.textContent = 'Downloading media assets...';
  const allMedia = [];

  issues.forEach((issue) => {
    if (issue.body) allMedia.push(...extractMediaUrls(issue.body, false));
    if (issue.body_html) allMedia.push(...extractMediaUrls(issue.body_html, true));
    
    issue.comments.forEach((comment) => {
      if (comment.body) allMedia.push(...extractMediaUrls(comment.body, false));
      if (comment.body_html) allMedia.push(...extractMediaUrls(comment.body_html, true));
    });
  });

  const mediaTypeByUrl = {};
  allMedia.forEach((item) => {
    if (item.url && !mediaTypeByUrl[item.url]) {
      mediaTypeByUrl[item.url] = item.type;
    }
  });

  const uniqueUrls = [...new Set(allMedia.map((m) => normalizeMediaUrl(m.url)))]
    .filter(url => {
      if (!url || url.startsWith('data:')) return false;
      try { new URL(url); return true; } catch { return false; }
    });
    
  let downloadedCount = 0;
  const downloadedUrls = [];
  const failedUrls = [];
  for (const url of uniqueUrls) {
    downloadedCount++;
    statusText.textContent = `Downloading media ${downloadedCount}/${uniqueUrls.length}...`;
    
    const blob = await downloadMediaAsBlob(url, currentToken);
    if (blob) {
      // determine extension
      let ext = 'bin';
      const type = blob.type;
      if (type.includes('/')) {
        ext = type.split('/')[1].split(';')[0];
      }

      if (ext === 'svg+xml') {
        ext = 'svg';
      }
      
      // fallback to url extension if available
      if (ext === 'bin' || ext === 'octet-stream') {
        const urlExt = url.split('.').pop().split('?')[0].split('#')[0];
        if (urlExt && urlExt.length < 5) ext = urlExt;
      }

      if (ext === 'bin' || ext === 'octet-stream') {
        const mediaType = mediaTypeByUrl[url];
        if (mediaType === 'image') ext = 'jpg';
        if (mediaType === 'video') ext = 'mp4';
      }

      // Generate filename (simple counter or hash would be better but counter is enough here)
      const filename = `media-${downloadedCount}.${ext}`;
      
      // Add to assets folder in zip
      assetsFolder.file(filename, blob);
      
      // Update map with relative path
      mediaMap[url] = `assets/${filename}`;
      downloadedUrls.push(url);
    } else {
      failedUrls.push(url);
    }
  }
  return {
    uniqueUrls,
    downloadedUrls,
    failedUrls,
  };
}

async function replaceMediaWithLocalPathsInIssues(issues, mediaMap, failedUrls = []) {
  for (const issue of issues) {
    if (issue.body_html) {
      issue.body_html = await replaceMediaWithLocalPaths(issue.body_html, mediaMap);
      issue.body_html = await replaceFailedMediaWithMessage(issue.body_html, failedUrls);
    }
    for (const comment of issue.comments) {
      if (comment.body_html) {
        comment.body_html = await replaceMediaWithLocalPaths(comment.body_html, mediaMap);
        comment.body_html = await replaceFailedMediaWithMessage(comment.body_html, failedUrls);
      }
    }
  }
}

const parseIssueNumberFromFileName = (fileName) => {
  const match = fileName.match(/^issue-(\d+)\.html$/i);
  return match ? Number(match[1]) : null;
};

const isIssueFile = (file) => parseIssueNumberFromFileName(file.name) !== null;

const isLikelyMediaAssetFile = (fileName) => /\.(jpg|jpeg|png|gif|webp|svg|mp4|webm|mov|avi)$/i.test(fileName);

const normalizeIssuesApiUrl = (value) => {
  const parsed = new URL(value);
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString();
};

const extractIssueTitle = (doc) => {
  const heading = doc.querySelector('h1')?.textContent?.trim() || '';
  if (heading) {
    const withoutNumberPrefix = heading.replace(/^#\d+\s*:\s*/, '').trim();
    if (withoutNumberPrefix) return withoutNumberPrefix;
  }

  const titleTag = doc.querySelector('title')?.textContent?.trim() || '';
  if (titleTag) {
    const cleanedTitle = titleTag.replace(/^Issue\s*#\d+\s*:\s*/i, '').trim();
    if (cleanedTitle) return cleanedTitle;
  }

  return 'Imported issue';
};

const extractIssueLabels = (doc) =>
  Array.from(doc.querySelectorAll('.label-list .label-chip'))
    .map((node) => node.textContent?.trim())
    .filter(Boolean);

const extractIssueBodyText = (doc) => {
  const issueBodyNode = doc.querySelector('.issue-body');
  const issueBodyText = issueBodyNode?.textContent?.trim() || 'Imported from GitHub Issue Exporter.';

  const commentNodes = Array.from(doc.querySelectorAll('.comment'));
  const commentsText = commentNodes
    .map((commentNode) => {
      const header = commentNode.querySelector('.comment-header')?.textContent?.trim() || 'Comment';
      const body = commentNode.querySelector('.comment-body')?.textContent?.trim() || '';
      if (!body) return '';
      return `### ${header}\n\n${body}`;
    })
    .filter(Boolean)
    .join('\n\n---\n\n');

  if (!commentsText) {
    return issueBodyText;
  }

  return `${issueBodyText}\n\n---\n\n## Imported comments snapshot\n\n${commentsText}`;
};

const extractMediaReferencesFromIssue = (doc) => {
  const relevantNodes = doc.querySelectorAll('.issue-body, .comment-body');
  const refs = new Set();

  relevantNodes.forEach((container) => {
    container.querySelectorAll('img[src], source[src], video[src], a[href]').forEach((node) => {
      const value = node.getAttribute('src') || node.getAttribute('href') || '';
      const normalizedValue = value.trim();
      if (!normalizedValue) return;
      if (normalizedValue.startsWith('assets/') || normalizedValue.includes('/assets/')) {
        refs.add(normalizedValue);
      }
    });
  });

  return [...refs];
};

const parseIssueHtmlFile = async (file) => {
  const content = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/html');

  return {
    sourceIssueNumber: parseIssueNumberFromFileName(file.name),
    sourceFileName: file.name,
    title: extractIssueTitle(doc),
    body: extractIssueBodyText(doc),
    labels: extractIssueLabels(doc),
    mediaReferences: extractMediaReferencesFromIssue(doc),
  };
};

const setImportStatus = (message, statusClass = '') => {
  if (!importStatus) return;
  importStatus.textContent = message;
  importStatus.className = ['status', statusClass].filter(Boolean).join(' ');
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const formatDuration = (totalMilliseconds) => {
  const totalSeconds = Math.max(0, Math.ceil(totalMilliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
};

const parseRetryAfterMilliseconds = (responseHeaders) => {
  const retryAfter = responseHeaders.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }

  const resetEpochSeconds = Number(responseHeaders.get('x-ratelimit-reset'));
  if (!Number.isNaN(resetEpochSeconds) && resetEpochSeconds > 0) {
    const waitMilliseconds = (resetEpochSeconds * 1000) - Date.now() + 1000;
    if (waitMilliseconds > 0) {
      return waitMilliseconds;
    }
  }

  return 0;
};

const calculateRetryDelayMilliseconds = (response, errorBodyText, attempt) => {
  const lowerBody = (errorBodyText || '').toLowerCase();
  const isSecondaryRateLimit =
    response.status === 403 && (lowerBody.includes('secondary rate limit') || lowerBody.includes('temporarily blocked from content creation'));
  const isPrimaryRateLimit = response.status === 429;

  if (!isSecondaryRateLimit && !isPrimaryRateLimit) {
    return 0;
  }

  const headerDelay = parseRetryAfterMilliseconds(response.headers);
  if (headerDelay > 0) {
    return headerDelay;
  }

  const exponentialFallback = 5000 * (2 ** (attempt - 1));
  return Math.min(exponentialFallback, 120000);
};

const getImportSpeedConfig = (selectedSpeed) => {
  if (selectedSpeed && IMPORT_SPEED_CONFIG[selectedSpeed]) {
    return {
      speed: selectedSpeed,
      ...IMPORT_SPEED_CONFIG[selectedSpeed],
    };
  }

  return {
    speed: DEFAULT_IMPORT_SPEED,
    ...IMPORT_SPEED_CONFIG[DEFAULT_IMPORT_SPEED],
  };
};

const updateImportReport = ({
  importSpeed = DEFAULT_IMPORT_SPEED,
  repoConnection = 'Not attempted',
  issuesAttempted = 0,
  issuesSucceeded = 0,
  issuesFailed = 0,
  mediaAttempted = 0,
  mediaSucceeded = 0,
  mediaFailed = 0,
  messages = [],
} = {}) => {
  if (!importReport) return;

  importReport.hidden = false;
  reportTargetRepoConnection.textContent = repoConnection;
  reportIssuesAttempted.textContent = String(issuesAttempted);
  reportIssuesSucceeded.textContent = String(issuesSucceeded);
  reportIssuesFailed.textContent = String(issuesFailed);
  reportMediaAttempted.textContent = String(mediaAttempted);
  reportMediaSucceeded.textContent = String(mediaSucceeded);
  reportMediaFailed.textContent = String(mediaFailed);
  importBrowserMessages.value = messages.join('\n');

  latestImportReport = {
    generatedAt: new Date().toISOString(),
    targetIssuesApiUrl: targetIssuesApiUrlInput?.value?.trim() || '',
    importSpeed,
    repoConnection,
    issuesAttempted,
    issuesSucceeded,
    issuesFailed,
    mediaAttempted,
    mediaSucceeded,
    mediaFailed,
    messages,
  };

  if (downloadImportReportButton) {
    downloadImportReportButton.disabled = false;
  }
};

const generateImportReportText = (report) => {
  if (!report) return '';

  return [
    'GitHub Issue Importer - Import Report',
    `Generated: ${new Date(report.generatedAt).toLocaleString()}`,
    `Target Issues API URL: ${report.targetIssuesApiUrl || 'Not provided'}`,
    `Import speed: ${report.importSpeed || DEFAULT_IMPORT_SPEED}`,
    '',
    `Target repo connection: ${report.repoConnection}`,
    `Total issues attempted: ${report.issuesAttempted}`,
    `Issues imported successfully: ${report.issuesSucceeded}`,
    `Issues failed to import: ${report.issuesFailed}`,
    `Total media assets attempted: ${report.mediaAttempted}`,
    `Media assets imported successfully: ${report.mediaSucceeded}`,
    `Media assets failed to import: ${report.mediaFailed}`,
    '',
    'Import Success/Failure Messages:',
    ...(report.messages.length ? report.messages : ['(none)']),
    '',
  ].join('\n');
};

const downloadImportReport = (report) => {
  if (!report) return;

  const content = generateImportReportText(report);
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = `import-report-${Date.now()}.txt`;
  link.click();
  URL.revokeObjectURL(downloadUrl);
};

const validateImportRequest = () => {
  const token = importTokenInput?.value?.trim() || '';
  const targetUrl = targetIssuesApiUrlInput?.value?.trim() || '';
  const files = Array.from(importSourceFolderInput?.files || []);
  const importSpeed = importSpeedSelect?.value || DEFAULT_IMPORT_SPEED;

  if (!token || !targetUrl || files.length === 0) {
    return {
      isValid: false,
      message: 'Missing required information. Add an import token, a valid target issues URL, and an export folder before importing.',
      token,
      targetUrl,
      files,
      importSpeed,
    };
  }

  try {
    const normalizedTargetUrl = normalizeIssuesApiUrl(targetUrl);
    return {
      isValid: true,
      token,
      targetUrl: normalizedTargetUrl,
      files,
      importSpeed,
    };
  } catch {
    return {
      isValid: false,
      message: 'Target repository Issues API URL must be a valid URL.',
      token,
      targetUrl,
      files,
      importSpeed,
    };
  }
};

const verifyTargetIssuesEndpoint = async (targetUrl, token) => {
  const verifyUrl = `${targetUrl}${targetUrl.includes('?') ? '&' : '?'}per_page=1`;
  const response = await fetch(verifyUrl, {
    method: 'GET',
    headers: buildHeaders(token),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Target repository connection failed (${response.status}): ${bodyText || 'Unknown error'}`);
  }
};

const createIssueInTargetRepo = async (targetUrl, token, issuePayload, importSpeedConfig, onRetry) => {
  for (let attempt = 1; attempt <= importSpeedConfig.maxRetryAttempts; attempt += 1) {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        ...buildHeaders(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(issuePayload),
    });

    if (response.ok) {
      return await response.json();
    }

    const bodyText = await response.text();
    const waitMilliseconds = calculateRetryDelayMilliseconds(response, bodyText, attempt);

    if (waitMilliseconds > 0 && attempt < importSpeedConfig.maxRetryAttempts) {
      if (onRetry) {
        onRetry({
          attempt,
          maxAttempts: importSpeedConfig.maxRetryAttempts,
          waitMilliseconds,
          status: response.status,
          bodyText,
        });
      }
      await sleep(waitMilliseconds);
      continue;
    }

    throw new Error(`Issue create failed (${response.status}): ${bodyText || 'Unknown error'}`);
  }

  throw new Error('Issue create failed after retries.');
};

if (importIssuesForm) {
  const storedImportToken = localStorage.getItem(IMPORT_TOKEN_STORAGE_KEY);
  if (storedImportToken && importTokenInput) {
    importTokenInput.value = storedImportToken;
  }
  updateImportSignOutButtonState();

  if (importSpeedSelect) {
    const storedImportSpeed = localStorage.getItem(IMPORT_SPEED_STORAGE_KEY);
    const initialSpeed = IMPORT_SPEED_CONFIG[storedImportSpeed] ? storedImportSpeed : DEFAULT_IMPORT_SPEED;
    importSpeedSelect.value = initialSpeed;

    importSpeedSelect.addEventListener('change', () => {
      const selectedSpeed = IMPORT_SPEED_CONFIG[importSpeedSelect.value] ? importSpeedSelect.value : DEFAULT_IMPORT_SPEED;
      importSpeedSelect.value = selectedSpeed;
      localStorage.setItem(IMPORT_SPEED_STORAGE_KEY, selectedSpeed);
    });
  }

  if (importTokenInput) {
    importTokenInput.addEventListener('input', () => {
      localStorage.setItem(IMPORT_TOKEN_STORAGE_KEY, importTokenInput.value.trim());
      updateImportSignOutButtonState();
    });
  }

  if (importSignOutButton) {
    importSignOutButton.addEventListener('click', () => {
      localStorage.removeItem(IMPORT_TOKEN_STORAGE_KEY);
      if (importTokenInput) {
        importTokenInput.value = '';
      }
      updateImportSignOutButtonState();
      setImportStatus('Import token removed. Enter a token to import issues.', '');
    });
  }

  if (downloadImportReportButton) {
    downloadImportReportButton.disabled = true;
    downloadImportReportButton.addEventListener('click', () => {
      if (!latestImportReport) {
        setImportStatus('Run an import first to generate a downloadable report.', 'status-error');
        return;
      }
      downloadImportReport(latestImportReport);
    });
  }

  importIssuesForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const messages = [];
    const validation = validateImportRequest();

    if (!validation.isValid) {
      importValidationWarning.hidden = false;
      setImportStatus(validation.message, 'status-error');
      updateImportReport({
        repoConnection: 'Validation failed',
        messages: [validation.message],
      });
      return;
    }

    importValidationWarning.hidden = true;
    importIssuesButton.disabled = true;
    const importSpeedConfig = getImportSpeedConfig(validation.importSpeed);
    setImportStatus(`Starting import (${importSpeedConfig.label} mode)...`, 'loading');
    messages.push(`INFO: Import speed set to ${importSpeedConfig.label} mode.`);

    const issueFiles = validation.files
      .filter(isIssueFile)
      .sort((left, right) => (parseIssueNumberFromFileName(left.name) || 0) - (parseIssueNumberFromFileName(right.name) || 0));

    const mediaFileCount = validation.files.filter((file) => isLikelyMediaAssetFile(file.name)).length;

    if (!issueFiles.length) {
      const noIssuesMessage = 'No issue-<number>.html files were found in the selected folder.';
      setImportStatus(noIssuesMessage, 'status-error');
      updateImportReport({
        importSpeed: importSpeedConfig.speed,
        repoConnection: 'Not attempted',
        mediaAttempted: mediaFileCount,
        mediaSucceeded: 0,
        mediaFailed: mediaFileCount,
        messages: [noIssuesMessage],
      });
      importIssuesButton.disabled = false;
      return;
    }

    let repoConnectionStatus = 'Connected';
    let issuesSucceeded = 0;
    let issuesFailed = 0;

    try {
      setImportStatus('Verifying target repository access...', 'loading');
      await verifyTargetIssuesEndpoint(validation.targetUrl, validation.token);

      setImportStatus(`Parsing ${issueFiles.length} issue file(s)...`, 'loading');
      const parsedIssues = await Promise.all(issueFiles.map(parseIssueHtmlFile));

      for (let index = 0; index < parsedIssues.length; index += 1) {
        const parsedIssue = parsedIssues[index];
        const remainingAfterCurrent = parsedIssues.length - (index + 1);
        const estimatedRemainingMs = remainingAfterCurrent * importSpeedConfig.requestDelayMs;
        const etaText = formatDuration(estimatedRemainingMs);
        setImportStatus(`Importing issue ${index + 1}/${parsedIssues.length}: ${parsedIssue.title} · ETA ~ ${etaText}`, 'loading');

        try {
          await createIssueInTargetRepo(validation.targetUrl, validation.token, {
            title: parsedIssue.title,
            body: parsedIssue.body,
            labels: parsedIssue.labels,
          }, importSpeedConfig, ({ attempt, maxAttempts, waitMilliseconds, status }) => {
            const seconds = Math.ceil(waitMilliseconds / 1000);
            const retryMessage = `RATE LIMIT: Issue ${parsedIssue.sourceFileName} hit HTTP ${status}. Waiting ${seconds}s before retry ${attempt + 1}/${maxAttempts}.`;
            messages.push(retryMessage);
            setImportStatus(`Rate limited by GitHub. Waiting ${seconds}s before retrying...`, 'loading');
          });
          issuesSucceeded += 1;
          messages.push(`SUCCESS: ${parsedIssue.sourceFileName} imported.`);
        } catch (error) {
          issuesFailed += 1;
          messages.push(`FAILED: ${parsedIssue.sourceFileName} could not be imported. ${error.message}`);
        }

        if (index < parsedIssues.length - 1) {
          await sleep(importSpeedConfig.requestDelayMs);
        }
      }

      const mediaRefsAttempted = parsedIssues.reduce((total, issue) => total + issue.mediaReferences.length, 0);
      const mediaAttempted = Math.max(mediaFileCount, mediaRefsAttempted);
      const mediaFailed = mediaAttempted;

      if (mediaAttempted > 0) {
        messages.push('INFO: Media files/references were detected, but direct media upload to GitHub Issues is not supported by this browser-only import flow.');
      }

      updateImportReport({
        importSpeed: importSpeedConfig.speed,
        repoConnection: repoConnectionStatus,
        issuesAttempted: parsedIssues.length,
        issuesSucceeded,
        issuesFailed,
        mediaAttempted,
        mediaSucceeded: 0,
        mediaFailed,
        messages,
      });

      if (issuesFailed === 0) {
        setImportStatus(`Import complete. ${issuesSucceeded} issue(s) imported successfully.`, 'status-success');
      } else {
        setImportStatus(`Import finished with partial failures. ${issuesSucceeded} succeeded, ${issuesFailed} failed.`, 'status-error');
      }
    } catch (error) {
      repoConnectionStatus = 'Failed';
      messages.push(error.message);

      updateImportReport({
        importSpeed: importSpeedConfig.speed,
        repoConnection: repoConnectionStatus,
        issuesAttempted: issueFiles.length,
        issuesSucceeded,
        issuesFailed: Math.max(issuesFailed, issueFiles.length - issuesSucceeded),
        mediaAttempted: mediaFileCount,
        mediaSucceeded: 0,
        mediaFailed: mediaFileCount,
        messages,
      });

      setImportStatus(`Import failed: ${error.message}`, 'status-error');
    } finally {
      importIssuesButton.disabled = false;
    }
  });
}
