import { db } from "ponder:api";
import { ponderSqlReader } from "../ponder-store.js";
import { createIndexerApi } from "./app.js";

export default createIndexerApi(ponderSqlReader(db));
