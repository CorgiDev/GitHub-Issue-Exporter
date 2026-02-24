const form = document.getElementById('search-form');
const statusText = document.getElementById('status');
const resultsTable = document.getElementById('results-table');
const resultsBody = document.getElementById('results-body');
const signOutButton = document.getElementById('signOutButton');
const AUTH_ERROR_MESSAGE =
  'Results could not be fetched because the user is either not logged in or does not have sufficient privileges for the repo they wish to query.';

const parseLabels = (raw) =>
  raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

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
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
});

const updateSignOutButtonState = () => {
  signOutButton.disabled = !form.token.value.trim();
};

const ensureAuthenticatedUser = async (token) => {
  const response = await fetch('https://api.github.com/user', {
    headers: buildHeaders(token),
  });

  if (!response.ok) {
    throw new Error(AUTH_ERROR_MESSAGE);
  }
};

const fetchAllOpenIssues = async (owner, repo, token) => {
  const collected = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=open&per_page=100&page=${page}`,
      {
        headers: buildHeaders(token),
      }
    );

    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        throw new Error(AUTH_ERROR_MESSAGE);
      }
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = await response.json();
    const issuesOnly = data.filter((item) => !item.pull_request);
    collected.push(...issuesOnly);

    if (data.length < 100) {
      break;
    }

    page += 1;
  }

  return collected;
};

const filterByLabels = (issues, includeLabels, excludeLabels) =>
  issues.filter((issue) => {
    const issueLabels = issue.labels.map((label) => label.name.toLowerCase());

    const matchesIncluded = includeLabels.every((label) => issueLabels.includes(label));
    const hasExcluded = excludeLabels.some((label) => issueLabels.includes(label));

    return matchesIncluded && !hasExcluded;
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
      const labelsText = labels.length ? labels.join(', ') : 'None';
      const labelChips = labels.length
        ? labels
            .map((labelName) => `<span class="label-chip">${escapeHtml(labelName)}</span>`)
            .join('')
        : '<span>None</span>';

      return `
        <tr>
          <td>${issue.number}</td>
          <td>${escapeHtml(issue.title)}</td>
          <td>${escapeHtml(labelsText)}</td>
          <td>${formatDate(issue.created_at)}</td>
          <td><div class="label-list">${labelChips}</div></td>
          <td><a href="${issue.html_url}" target="_blank" rel="noopener noreferrer">Open Issue</a></td>
        </tr>
      `;
    })
    .join('');

  resultsTable.hidden = false;
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const token = form.token.value.trim();
  const owner = form.owner.value.trim();
  const repo = form.repo.value.trim();
  const includeLabels = parseLabels(form.includeLabels.value);
  const excludeLabels = parseLabels(form.excludeLabels.value);

  const submitButton = form.querySelector('button[type="submit"]');

  statusText.textContent = 'Loading open issues...';
  submitButton.disabled = true;
  resultsTable.hidden = true;

  try {
    await ensureAuthenticatedUser(token);
    localStorage.setItem('githubIssueExporterToken', token);
    updateSignOutButtonState();

    const openIssues = await fetchAllOpenIssues(owner, repo, token);
    const filteredIssues = filterByLabels(openIssues, includeLabels, excludeLabels);

    renderRows(filteredIssues);
    statusText.textContent = `Found ${filteredIssues.length} open issue(s).`;
  } catch (error) {
    resultsBody.innerHTML = '';
    resultsTable.hidden = true;
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

form.token.addEventListener('input', () => {
  updateSignOutButtonState();
});

signOutButton.addEventListener('click', () => {
  localStorage.removeItem('githubIssueExporterToken');
  form.token.value = '';
  updateSignOutButtonState();
  statusText.textContent = 'Signed out. Enter a GitHub access token to search issues.';
  resultsBody.innerHTML = '';
  resultsTable.hidden = true;
});
