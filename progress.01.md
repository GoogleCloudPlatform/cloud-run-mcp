# Project: Cloud Run MCP Server - New Tool `cloud-run-deploy-model`

This document summarizes the work completed on the Cloud Run MCP server project.

## 1. Goal

The primary objective was to create a new MCP tool named `cloud-run-deploy-model`. This tool is designed to simplify the deployment of Large Language Models (LLMs) to Google Cloud Run by abstracting away complex configurations.

## 2. Implementation Details

### New File: `lib/cloud-run-deploy-model.js`

- A new file was created to contain the core logic for the `cloud-run-deploy-model` tool.
- It exports a `deployModel` function that orchestrates the deployment.
- The function accepts parameters such as `projectId`, `region`, `serviceName`, `framework` (ollama or vllm), `model`, and an optional `hfToken`.
- It determines the correct container image based on the selected framework (`ollama/ollama` or `vllm/vllm-openai`).
- It includes a placeholder for a `calculateResources` function, which currently returns a default configuration (4 vCPU, 16Gi memory, 1 GPU) but is intended to be updated later to calculate resources based on the model size.

### Tool Registration: `tools.js`

- The new `cloud_run_deploy_model` tool was defined and registered within `tools.js`.
- A Zod schema was created to validate the input parameters: `project`, `region`, `service`, `framework`, `model`, and `hf_token`.
- The tool was registered for both local and remote execution environments by adding it to the `registerTools` and `registerToolsRemote` functions, respectively.

### Core Logic Enhancement: `lib/cloud-run-deploy.js`

- The existing `deployImage` function was enhanced to support more advanced container configurations required by the new tool.
- The function signatures for `deployImage` and the internal `deployToCloudRun` were updated to accept new parameters: `containerArgs`, `containerEnv`, `containerPort`, and `resources`.
- The `deployToCloudRun` function was modified to:
    - Apply the new container arguments, environment variables, and port settings.
    - Configure resource limits (CPU, memory).
    - **Enable GPU support**: If GPU resources are specified, the service is automatically configured to use the `EXECUTION_ENVIRONMENT_GEN2` and the `nvidia.com/gpu` resource limit is set.

## 3. Bug Fixes and Improvements

### Corrected GPU Resource Key

- Researched the `@google-cloud/run` v2 API for GPU configurations.
- Identified that the `deployToCloudRun` function in `lib/cloud-run-deploy.js` was using an incorrect resource key for GPUs (`nvidia.com/gpu`).
- Corrected the key to the proper value: `cloud.google.com/gpu`.

### Improved Default GPU Resources

- Updated the `calculateResources` function in `lib/cloud-run-deploy-model.js` to provide a better default configuration for GPU deployments.
- The recommended resources were increased from the minimum of 4 vCPU and 16Gi memory to 8 vCPU and 32Gi memory for optimal performance, based on Google Cloud's documentation.

## 4. How to Test

Instructions were provided to test this new functionality using the Gemini CLI.

1.  **Start the local MCP Server**: In one terminal, run `npm start` from the project root (`/Users/odeds/cloud-run-mcp`).
2.  **Configure Gemini CLI**: In a separate terminal, edit the `~/.gemini/extensions/cloud-run/gemini-extension.json` file to point to the local server by replacing the `command` and `args` with a `url` key:
    ```json
    "mcpServers": {
      "cloud-run": {
        "url": "http://localhost:8080/sse"
      }
    }
    ```
3.  **Run Gemini CLI**: Restart the Gemini CLI. It will now connect to your local server, allowing you to test the `cloud-run-deploy-model` tool.
    Example command:
    ```
    gemini: cloud-run-deploy-model --framework ollama --model llama3 --project your-gcp-project-id
    ```

This summary covers all the changes made to the project.