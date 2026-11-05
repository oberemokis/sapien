import type { Dictionary } from "@sapien/i18n";

// Русский задаёт ключи, английский повторяет его форму.
const ru = {
  title: "Интеграции",
  description: "GitHub и GitLab по личному токену. Пока здесь только подключение: что агент делает с ними, появится позже.",
  connection: "Подключение",
  checking: "Проверяю…",
  connected: "Подключено как {{login}} на {{host}}.",
  connect: "Подключить",
  disconnect: "Отключить",
  host: "Адрес сервера GitLab",
  hostHint: "Пустой адрес подключает gitlab.com. Свой сервер только по https.",
  token: "Токен {{name}}",
  github: {
    description: "Личный токен GitHub. Токен хранится в системном хранилище паролей, окну его больше не видно.",
    hint: "Не подключено. Токен создают в GitHub: Settings → Developer settings → Personal access tokens.",
  },
  gitlab: {
    description:
      "Личный токен GitLab, облачного или своего сервера. Без адреса подключается gitlab.com. Токен хранится в системном хранилище паролей.",
    hint: "Не подключено. Токен создают в GitLab: Preferences → Access tokens, хватит права read_api.",
  },
  problems: {
    forge_token_empty: "Введите токен.",
    forge_token_rejected: "Сервер не принял токен: он неверный, отозван или без нужных прав.",
    forge_unreachable: "Сервер не отвечает: проверьте адрес и сеть.",
    forge_host_insecure: "Адрес должен быть по https.",
    forge_host_invalid: "По этому адресу не нашлось API GitLab: проверьте адрес сервера.",
    failed: "Не получилось, попробуйте ещё раз.",
  },
} as const;

const en: Dictionary<typeof ru> = {
  title: "Integrations",
  description: "GitHub and GitLab with a personal token. Only the connection lives here for now: what the agent does with them comes later.",
  connection: "Connection",
  checking: "Checking…",
  connected: "Connected as {{login}} on {{host}}.",
  connect: "Connect",
  disconnect: "Disconnect",
  host: "GitLab server address",
  hostHint: "An empty address connects gitlab.com. Your own server only over https.",
  token: "{{name}} token",
  github: {
    description: "A personal GitHub token. It is kept in the system password store and the window no longer sees it.",
    hint: "Not connected. Create a token in GitHub: Settings → Developer settings → Personal access tokens.",
  },
  gitlab: {
    description:
      "A personal GitLab token, for gitlab.com or your own server. Without an address it connects gitlab.com. The token is kept in the system password store.",
    hint: "Not connected. Create a token in GitLab: Preferences → Access tokens, the read_api scope is enough.",
  },
  problems: {
    forge_token_empty: "Enter a token.",
    forge_token_rejected: "The server did not accept the token: it is wrong, revoked or lacks the required scopes.",
    forge_unreachable: "The server does not respond: check the address and the network.",
    forge_host_insecure: "The address must use https.",
    forge_host_invalid: "No GitLab API was found at this address: check the server address.",
    failed: "That did not work, please try again.",
  },
};

declare module "@sapien/i18n" {
  interface Resources {
    forge: typeof ru;
  }
}

export const dictionary = { ru, en };
