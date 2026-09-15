// GitHub Pages has no rewrite rules: serving index.html as 404.html lets deep links reach the router.
import { copyFileSync, writeFileSync } from "node:fs";

copyFileSync("dist/index.html", "dist/404.html");
writeFileSync("dist/.nojekyll", "");
