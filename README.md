# GitHub-Issue-Exporter

A simple web app to search open GitHub issues by repository and label filters. The app uses the user's GitHub access token to authenticate requests, which helps reduce API rate limit issues and enforces repository permissions.

GitHub Pages Version: https://corgidev.github.io/GitHub-Issue-Exporter/

## How to run locally

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
   - Must have read access to Issues in the relevant repo.
- Repository owner
- Repository name
- **State Filter**: Choose to search for open issues, closed issues, or all issues (defaults to all if not selected)
- **Include Labels - ALL**: Issues must have ALL specified labels (AND logic)
- **Include Labels - ANY**: Issues must have at least ONE of the specified labels (OR logic)
- **Exclude Labels - ANY**: Issues with ANY of these labels will be excluded (OR logic)
- **Exclude Labels - ALL**: Issues with ALL of these labels will be excluded (AND logic)

### Label Filtering Examples

**Include Labels - ALL**: `bug,regression` → Only issues with both "bug" AND "regression"
**Include Labels - ANY**: `help wanted,good first issue` → Issues with "help wanted" OR "good first issue" OR both
**Exclude Labels - ANY**: `duplicate,wontfix` → Excludes issues with "duplicate" OR "wontfix" OR both
**Exclude Labels - ALL**: `needs-info,stale` → Only excludes issues that have both "needs-info" AND "stale"

All label filters are comma-separated and case-insensitive. You can use any combination of these filters together.

If authentication fails (invalid/missing token) or the user lacks access to the repository, the app returns:

"Results could not be fetched because the user is either not logged in or does not have sufficient privileges for the repo they wish to query."

## Results table columns

- ID
- Title
- Created Date
- Labels on Issue
- Issue URL

## Export to Offline HTML

After searching for issues, you can export them as a complete offline HTML website:

1. Click the "Export as Offline HTML" button
2. The app will:
   - Fetch full issue details including bodies and comments
   - Extract media URLs from both markdown and HTML-rendered content
   - Download all images and videos (including those in `<img>`, `<video>`, `<source>`, and `srcset` attributes)
   - Convert downloaded media to base64 data URLs for offline viewing
   - Generate an index page with the results table
   - Create individual pages for each issue
   - Package everything into a downloadable ZIP file

### Media Handling

The export feature comprehensively extracts and downloads:

- Markdown images: `![alt](url)`
- HTML images: `<img src="..." />` and `srcset` attributes
- HTML videos: `<video>` and `<source>` tags
- Direct links to image/video files in issue bodies and comments

Media that cannot be downloaded (due to CORS restrictions or network errors) will keep their original URLs as fallback links.

#### Code Snippets for Media

To aid in linking media, you can use the following snippets. With these you would just need to swap out the `fileName` placeholder for the actual name of the video or image, and add an image description in the `alt` element of the `img` element.

Be careful to update the video HTML element if the video downloads in a format other than MP4.

```html
<video controls width="90%">
  <source src="assets/fileName.mp4" type="video/mp4" />
  Download the <a href="assets/fileName.mp4">MP4</a> video.
</video>
```
```html
<img src="assets/fileName.png" alt="imageDescription" style="border: 1px solid black;"/>
```

### Exported Site Structure

- **index.html**: Home page displaying all search results in a table
- **issue-{number}.html**: Individual pages for each issue
- **styles.css**: Shared stylesheet for the offline website

### Individual Issue Pages Include

- Issue title, ID, creation date, author, and state
- Labels (collapsible section)
- Issue description/body with embedded media
- Comments (collapsible section) with author and timestamp
- All images and videos embedded as base64 data URLs for offline access
