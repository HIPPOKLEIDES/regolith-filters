// @ts-check
const fs = require("fs");
const { randomUUID } = require("crypto");
const { glob } = require("glob");

const uuidFile = "data/gametests/uuid.txt";
let defaultUUID = /** @type {string} */ (randomUUID());
if (fs.existsSync(uuidFile)) {
  defaultUUID = fs.readFileSync(uuidFile).toString();
} else {
  fs.writeFileSync(uuidFile, defaultUUID);
}

const defSettings = {
  buildOptions: {
    external: [""], // Empty string to mark as string[]
    entryPoints: ["data/gametests/src/main.ts"],
    target: "es2020",
    format: "esm",
    bundle: true,
    minify: true,
  },
  moduleUUID: defaultUUID,
  modules: ["@minecraft/server@1.0.0"],
  moduleType: "script",
  manifest: "BP/manifest.json",
  outfile: "BP/scripts/main.js",
  outdir: "BP/scripts"
};
// Reset external property so that it does not cause issues
defSettings.buildOptions.external = [];

/** @type {typeof defSettings} */
const argParsed = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const settings = Object.assign({}, defSettings, argParsed);
settings.buildOptions = Object.assign({}, defSettings.buildOptions, settings.buildOptions);

function entryPathify(str) {
  return str.split("/").slice(1).join("/");
}
const bundle = settings.buildOptions.bundle;
let entry = "";
const out = settings.outfile ?? "BP/scripts/main.js"
settings.buildOptions.outfile = out;
entry = entryPathify(out);
if (!bundle) {
  entry = entryPathify(out);
  delete settings.buildOptions.outfile;
  settings.buildOptions.outdir = settings.outdir ?? "BP/scripts";
}

const external = bundle ? settings.buildOptions.external : [];

// Ensure types for settings
const typeMap = {
  buildOptions: "object",
  moduleUUID: "string",
  modules: "array",
  outfile: "string",
  outdir: "string",
  moduleType: "string",
  manifest: "string",
};
const throwTypeError = (k) => {
  throw new TypeError(`${k}: ${JSON.stringify(settings[k])} is not an ${typeMap[k]}`);
};
for (let k in typeMap) {
  if (typeMap[k] === "array") {
    if (!Array.isArray(settings[k])) throwTypeError(k);
  } else if (typeMap[k] === "object") {
    if (typeof settings[k] !== "object" || Array.isArray(settings[k])) throwTypeError(k);
  } else if (typeof settings[k] !== typeMap[k]) throwTypeError(k);
}

console.log("Modifying manifest.json");
const manifestStr = fs.readFileSync("BP/manifest.json", "utf8");
/** @type {{
  format_version: number; 
  header: {
    name: string;
    description: string;
    uuid: string;
    version: [number, number, number];
    min_engine_version: [number, number, number];
  };
  modules: {
    description?: string; 
    type: string; 
    language?: string; 
    entry?: string; 
    uuid: string; 
    version: string | [number, number, number];
  }[]; 
  dependencies: ({module_name: string; version: string} | {uuid: string; version: [number, number, number]})[];
}} */
const manifest = JSON.parse(manifestStr);

// Ensure manifest contains dependencies array
if (!manifest.dependencies) manifest.dependencies = [];

// Add script module dependencies to manifest
for (let module of settings.modules) {
  const match = module.match(/(@[^@]+)@(.+)/);
  if (!match) {
    throw "Invalid module provided in settings, please follow the format '<module>@<version>' or '<module>'";
  }
  const name = match[1];
  let version = match[2];

  if (!version) throw `No version provided for module '${name}'`;
  const versionMatch = version.match(/\d+\.\d+\.\d+(?:-beta)?/);
  if (!versionMatch || versionMatch[0] !== version) {
    throw `Version '${version}' is not a valid module version`;
  }

  let exists = false;
  if (
    manifest.dependencies.findIndex((v) => {
      if (typeof v.version !== "string") return;
      //@ts-ignore
      if (v.module_name !== name) return;
      exists = true;
      return v.version !== version;
    }) !== -1
  ) {
    throw `Module '${name}' already exists in manifest with a different version`;
  }

  if (!exists) {
    external.push(name);
    manifest.dependencies.push({
      module_name: name,
      version: version,
    });
  } else {
    console.warn(`Module ${name} already exists in the manifest and will not be added again`);
  }
}

// Ensure manifest contains a modules array
if (!manifest.modules) manifest.modules = [];

// Add script module to manifest
let hasModule = false;
if (
  manifest.modules.findIndex((v) => {
    if (v.type !== settings.moduleType) return;
    hasModule = true;
    if (v.uuid !== settings.moduleUUID) return true;
    if (v.entry !== entry) return true;
  }) !== -1
) {
  throw `Existing manifest module of type ${settings.moduleType} found with different properties`;
}

if (!hasModule) {
  manifest.modules.push({
    description: "Scripting module",
    type: settings.moduleType,
    uuid: settings.moduleUUID,
    version: [0, 0, 1],
    entry,
  });
} else {
  console.warn(`Existing manifest module found with matching properties and will not be added again`);
}

console.log("Saving manifest.json");
fs.writeFileSync(settings.manifest, JSON.stringify(manifest, null, 4));

glob(settings.buildOptions.entryPoints).then((paths) => {
  settings.buildOptions.entryPoints = paths;
  require("./moveFiles.js");
  require("./build.js").run(settings);
})

