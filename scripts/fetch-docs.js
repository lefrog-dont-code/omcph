#!/usr/bin/env node

import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define paths
const outputPath = path.resolve(__dirname, "../docs/MCP-full.md");
const diffPath = path.resolve(__dirname, "../docs/MCP-diff.md");
const docsUrl = "https://modelcontextprotocol.io/llms-full.txt";

// Ensure docs directory exists
const docsDir = path.dirname(outputPath);
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
  console.log(`Created directory: ${docsDir}`);
}

console.log(`Fetching documentation from: ${docsUrl}`);

// Function to compare content and get diff
function compareAndGetDiff(newContent, existingFilePath) {
  if (!fs.existsSync(existingFilePath)) {
    return {
      isDifferent: true,
      diff: newContent,
    }; // File doesn't exist, so all content is new
  }

  const existingContent = fs.readFileSync(existingFilePath, "utf8");

  // Remove the first line (timestamp) from both contents for comparison
  const newContentLines = newContent.split("\n");
  const existingContentLines = existingContent.split("\n");

  const newContentWithoutTimestamp = newContentLines.slice(1).join("\n");
  const existingContentWithoutTimestamp = existingContentLines
    .slice(1)
    .join("\n");

  // If contents are the same, return no diff
  if (newContentWithoutTimestamp === existingContentWithoutTimestamp) {
    return {
      isDifferent: false,
      diff: "",
    };
  }

  // Find the new lines
  const existingSet = new Set(existingContentWithoutTimestamp.split("\n"));
  const newLines = newContentWithoutTimestamp
    .split("\n")
    .filter((line) => !existingSet.has(line));

  return {
    isDifferent: true,
    diff: newLines.join("\n"),
  };
}

// Fetch the content
https
  .get(docsUrl, (res) => {
    let data = "";

    // A chunk of data has been received
    res.on("data", (chunk) => {
      data += chunk;
    });

    // The whole response has been received
    res.on("end", () => {
      // Add timestamp to the top of the file
      const timestamp = `# Updated on: ${new Date().toISOString()}\n\n`;
      const dataWithTimestamp = timestamp + data;

      // Compare content and get diff
      const { isDifferent, diff } = compareAndGetDiff(
        dataWithTimestamp,
        outputPath
      );

      if (isDifferent) {
        // Write full content
        fs.writeFileSync(outputPath, dataWithTimestamp);
        console.log(`Documentation updated and saved to: ${outputPath}`);

        // Write diff content
        if (diff.trim()) {
          const diffWithTimestamp = timestamp + diff;
          fs.writeFileSync(diffPath, diffWithTimestamp);
          console.log(`New content diff saved to: ${diffPath}`);
          console.log("New content detected and saved.");
        }
      } else {
        console.log("No new content. Documentation remains unchanged.");
      }
    });
  })
  .on("error", (err) => {
    console.error(`Error fetching documentation: ${err.message}`);
    process.exit(1);
  });
