import { createApp } from "./http/app.js";

const port = parseInt(process.env.PORT || "3000", 10);
const app = createApp();

app.listen(port, () => {
  console.log(`KoManga API listening on port ${port}`);
});
