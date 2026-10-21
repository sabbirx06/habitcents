export function categoryIcon(category) {
  const paths = {
    transport: "M5 16V5h14v11zM8 19v-3m8 3v-3M5 10h14M8 13h1m6 0h1",
    food: "M5 3v6m3-6v6M5 6h3M6.5 9v12M17 3v18m0-18c-5 2-5 9 0 9",
    shopping: "M5 7h14l1 14H4zM9 8V5a3 3 0 016 0v3",
    subscriptions: "M4 5h16v14H4zM8 10l3-2v8l-3-2m6-4h3m-3 4h3",
    uncategorized: "M5 5h14v14H5zM9 12h6M12 9v6",
  };
  const tile = document.createElement("span"),
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    path = document.createElementNS(svg.namespaceURI, "path");
  tile.className = "transaction-icon";
  tile.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("viewBox", "0 0 24 24");
  path.setAttribute("d", Object.hasOwn(paths, category) ? paths[category] : paths.uncategorized);
  svg.append(path);
  tile.append(svg);
  return tile;
}
