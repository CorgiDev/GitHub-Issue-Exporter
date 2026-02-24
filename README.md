# GitHub-Issue-Exporter

A simple web app to search open GitHub issues by repository and label filters.

The app uses the user's GitHub access token to authenticate requests, which helps reduce API rate limit issues and enforces repository permissions.

## How to run

Because this app uses browser `fetch`, run it from a local web server (not directly as a `file://` page).

Example with Python:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Search inputs

- GitHub access token (required)
- Repository owner
- Repository name
- Labels to include (comma-separated)
- Labels to exclude (comma-separated)

If authentication fails (invalid/missing token) or the user lacks access to the repository, the app returns:

"Results could not be fetched because the user is either not logged in or does not have sufficient privileges for the repo they wish to query."

## Results table columns

- ID
- Title
- Labels
- Created Date
- Labels on Issue
- Issue URL
