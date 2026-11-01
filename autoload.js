// Адрес модели: сперва из ?model=..., затем из конфигурации сервера, затем соседний файл.
const params = new URLSearchParams(location.search);
const modelUrl = params.get("model")
    || (window.__MODEL_URL__ ? window.__MODEL_URL__ : "model.glb");

// Заголовок вкладки: имя модели берётся из name.json рядом с моделью.
const folderMatch = modelUrl.match(/^(.*?)[\\/]/);
const modelFolder = folderMatch ? folderMatch[1] : "";
if (modelFolder && modelUrl.toLowerCase().endsWith("model.glb")) {
    fetch(encodeURI(modelFolder + "/name.json"))
        .then(response => (response.ok ? response.json() : null))
        .then(info => {
            if (info && info.name) {
                document.title = 'Просмотр проекта "' + info.name + '"';
            }
        })
        .catch(() => {});
}

// Просмотрщик поднимается асинхронно, поэтому ждём его API.
let api = null;
for (let attempt = 0; attempt < 300; attempt += 1) {
  if (window.modelViewerApi && window.modelViewerApi.loadModelFromUrl) {
    api = window.modelViewerApi;
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 50));
}

if (!api) {
  document.getElementById("status-text").textContent = "Просмотрщик не запустился.";
} else {
  try {
    // Загрузку модели не ждём: внутри просмотрщика есть ожидание ответа
    // хоста, которого в браузере нет, и в фоновой вкладке оно не наступает
    // никогда.
    api.loadModelFromUrl(modelUrl);
    if (api.setPanelsHidden) {
      api.setPanelsHidden(true);
    }
  } catch (error) {
    document.getElementById("status-text").textContent = `Ошибка загрузки: ${error.message}`;
  }
}
