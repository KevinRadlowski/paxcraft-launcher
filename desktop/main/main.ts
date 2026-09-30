/**
 * Electron main entry — SweetCraft Launcher desktop shell (0.6A).
 */
import { app } from "electron";
import { bootstrapDesktop } from "./lifecycle.js";
import { DESKTOP_PRODUCT_NAME } from "../shared/product.js";

app.setName(DESKTOP_PRODUCT_NAME);
app.setAppUserModelId("fr.xbase.sweetcraft.launcher");

void bootstrapDesktop();
