const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

// Монорепу Expo настраивает сам. Uniwind обязан быть внешней обёрткой.
module.exports = withUniwindConfig(getDefaultConfig(__dirname), {
  cssEntryFile: "./src/global.css",
  // Типы className для компонентов React Native. Их пишет Metro, а в
  // репозитории они лежат, потому что tsc в CI запускается без Metro.
  dtsFile: "./src/uniwind-types.d.ts",
});
