import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { ConfigProvider as AntConfigProvider, App as AntApp } from "antd";
import { ConfigProvider as MobileConfigProvider } from "antd-mobile";
import zhCN from "antd/locale/zh_CN";
import zhCNMobile from "antd-mobile/es/locales/zh-CN";
import App from "./App";
import { store } from "./store";
import "antd/dist/reset.css";
import "antd-mobile/es/global";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <AntConfigProvider locale={zhCN} theme={{ token: { colorPrimary: "#0b9b7c", borderRadius: 12, fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif" } }}>
        <MobileConfigProvider locale={zhCNMobile}>
          <AntApp><App /></AntApp>
        </MobileConfigProvider>
      </AntConfigProvider>
    </Provider>
  </React.StrictMode>,
);
