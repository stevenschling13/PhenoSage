const tailwindPostcssPlugin = (() => {
  try {
    const major = Number(
      require("tailwindcss/package.json").version.split(".")[0] ?? "0",
    );
    // Tailwind CSS v4 moved the PostCSS plugin to @tailwindcss/postcss.
    if (major < 4) {
      return "tailwindcss";
    }
    require.resolve("@tailwindcss/postcss");
    return "@tailwindcss/postcss";
  } catch {
    // Tailwind CSS v3 continues to use tailwindcss as the PostCSS plugin.
    return "tailwindcss";
  }
})();

module.exports = {
  plugins: {
    [tailwindPostcssPlugin]: {},
    autoprefixer: {},
  },
};
