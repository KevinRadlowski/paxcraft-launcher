/**
 * Electron main entry — PaxCraft Launcher desktop shell.
 */
import { app } from "electron";
import { bootstrapDesktop } from "./lifecycle.js";
import { DESKTOP_APP_USER_MODEL_ID, DESKTOP_PRODUCT_NAME } from "../shared/product.js";

app.setName(DESKTOP_PRODUCT_NAME);
app.setAppUserModelId(DESKTOP_APP_USER_MODEL_ID);

void bootstrapDesktop();
