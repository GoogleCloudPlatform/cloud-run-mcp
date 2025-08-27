# How to contribute

We'd love to accept your patches and contributions to this project.

## Before you begin

### Sign our Contributor License Agreement

Contributions to this project must be accompanied by a
[Contributor License Agreement](https://cla.developers.google.com/about) (CLA).
You (or your employer) retain the copyright to your contribution; this simply
gives us permission to use and redistribute your contributions as part of the
project.

If you or your current employer have already signed the Google CLA (even if it
was for a different project), you probably don't need to do it again.

Visit <https://cla.developers.google.com/> to see your current agreements or to
sign a new one.

### Review our community guidelines

This project follows
[Google's Open Source Community Guidelines](https://opensource.google/conduct/).

## Contribution process

### Start with an issue

Before sending a pull request, please open an issue describing the bug or feature
you would like to address. This will allow maintainers of this project to guide
you in your design and implementation.

### Code reviews

All submissions, including submissions by project members, require review. We
use GitHub pull requests for this purpose. Consult
[GitHub Help](https://help.github.com/articles/about-pull-requests/) for more
information on using pull requests.

## Development

```bash
npm install
```

### Using MCP inspector

Load MCP Inspector in your browser:

```bash
npm run test:mcp
```

Open http://localhost:6274/

### Using a real MCP client

To use local stdio MCP server. In your MCP client configuration, use the following:

```json
{
  "mcpServers": {
    "cloud-run": {
      "command": "node",
      "args": ["/path/to/this/repo/cloud-run-mcp/mcp-server.js"]
    }
  }
}
```

To use remote MCP Server in a MCP client:

Start the MCP server locally with:

```bash
GCP_STDIO=false node /path/to/this/repo/cloud-run-mcp/mcp-server.js
```

Then, in your MCP client configuration, use the following:

```json
{
  "mcpServers": {
    "cloud-run": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:3000/sse"]
    }
  }
}
```

or, if your client supports the `url` attribute, you can use:

```
{
  "mcpServers": {
    "cloud-run": {
      "url": "http://localhost:3000/sse"
    }
  }
}
```

## Testing

### To test creating a new project (not using MCP)

See the `test/test-create-project.js` script. Run it with:

```bash
npm run test:create-project
```

This script will guide you through creating a new Google Cloud project and attempting to link it to a billing account. You can optionally provide a desired project ID.

### To test a simple deployment (not using MCP)

See the `test/test-deploy.js` script. Run it with:

```bash
npm run test:deploy
```

This script requires an existing Google Cloud Project ID to be provided when prompted or as a command-line argument.

## Publishing to npm

To update the [npm package]https://www.npmjs.com/package/@google-cloud/cloud-run-mcp)

Run the following:

* `git checkout -b new-release`
* `npm test`
* `npm version minor`
* `git push --follow-tags`
* On GitHub, [create a new release](https://github.com/GoogleCloudPlatform/cloud-run-mcp/releases/new) for this tag.

Then a [GitHub Action]https://github.com/GoogleCloudPlatform/cloud-run-mcp/blob/main/.github/workflows/npm-publish.yml) automatically publishes to npm when new releases are pushes.
