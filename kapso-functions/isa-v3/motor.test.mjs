// Tests del motor de Isa v3. Correr con: node --test kapso-functions/isa-v3/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("./motor.js", import.meta.url), "utf8");
const sandbox = { globalThis: {}, console, Date, Set, Response: class {}, fetch: () => { throw new Error("sin red en tests"); }, setTimeout };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
// Los objetos creados dentro de vm tienen otro Object.prototype; se clonan
// al contexto de los tests para que deepStrictEqual compare solo valores.
const clonar = (x) => (x instanceof sandbox.Set ? new Set(x) : x === undefined ? x : JSON.parse(JSON.stringify(x)));
const M = Object.fromEntries(Object.entries(sandbox.__isa3).map(([k, fn]) => [k, (...a) => clonar(fn(...a))]));

const AHORA = new Date("2026-11-24T15:00:00Z"); // martes 24 nov, 10am Bogotá

// Simulador: lleva el estado entre turnos como lo haria Kapso.
function conversacion(perfil = "Dago M L") {
  let vars = {};
  const historial = [];
  const turno = (texto, extra = {}) => {
    const entrada = texto === null ? null : { texto, opcionId: extra.opcion || null, tieneMedia: !!extra.media };
    const r = M.procesar(vars, entrada, { perfil, ahora: AHORA, resultadoInterprete: extra.interprete || null, leadPrevio: extra.leadPrevio || null });
    vars = { ...vars, ...r.vars };
    historial.push(r);
    return r;
  };
  return { turno, get vars() { return vars; } };
}
const textos = (r) => r.acciones.filter((a) => a.tipo).map((a) => a.body || a.caption || "").join("\n---\n");

test("flujo feliz completo sin IA: saludo -> 8 datos -> estimado", () => {
  const c = conversacion("Dago M L");
  let r = c.turno("Hola Isa de Espazios, quiero iniciar con la cotización.");
  assert.equal(r.edge, "esperar");
  assert.match(textos(r), /^Hola! hablas con Isa de Espazios .* Hablo con Dago M L\?$/);
  assert.doesNotMatch(textos(r), /¿/);

  r = c.turno("Si");
  assert.equal(c.vars.nombre, "Dago M L");
  assert.match(textos(r), /Ley 1581 de 2012/);
  assert.match(textos(r), /\*En qué ciudad está ubicada tu vivienda\?\*/);
  assert.equal(r.edge, "esperar");

  r = c.turno("bogota");
  assert.equal(c.vars.ciudad, "Bogotá");
  assert.equal(r.acciones[0].tipo, "lista");

  r = c.turno("Remodelación Total", { opcion: "tp_total" });
  assert.equal(c.vars.tipo_proyecto, "Remodelación Total");
  assert.match(textos(r), /presupuesto aproximado/);

  r = c.turno("30 millones");
  assert.equal(c.vars.presupuesto, "$30");
  assert.ok(r.acciones.some((a) => a.op === "guardar_tibio"), "guarda lead tibio");
  assert.match(textos(r), /conjunto o barrio/);

  r = c.turno("Porto 13");
  r = c.turno("Apto Tipo E: Area Construida 43,04 m2 / Area Privada 37,78 m2");
  assert.equal(c.vars.m2, 38);
  assert.equal(r.acciones[0].tipo, "botones", "pregunta baños con botones (31-44)");

  r = c.turno("2 baños", { opcion: "b_2" });
  assert.equal(c.vars.banos, 2);
  r = c.turno("en 2 meses");
  assert.equal(c.vars.plazo, "2 meses");
  assert.match(textos(r), /correo/);

  r = c.turno("Dago.ML@Gmail.com");
  assert.equal(c.vars.correo, "dago.ml@gmail.com");
  const ops = r.acciones.filter((a) => a.op).map((a) => a.op);
  assert.deepEqual(ops, ["guardar_lead", "estimado"]);
  assert.equal(c.vars.paso, "post_estimado");
  // Ninguno de estos turnos pidio IA
  assert.ok(r.edge === "esperar");
});

test("el estimado manda imagen general + detalle del paquete elegido con botones de los otros 2", () => {
  const v = { nombre: "Dago M L", m2: 38, tipo_proyecto: "Intermedio" };
  const { mensajes, vistos } = M.mensajesEstimado(v, { imageUrl: "https://x/gen.png", paqueteElegido: { imageUrl: "https://x/det.png" } });
  assert.equal(mensajes.length, 2);
  assert.equal(mensajes[0].tipo, "imagen");
  assert.equal(mensajes[1].headerImage, "https://x/det.png");
  assert.deepEqual(mensajes[1].botones.map((b) => b.id), ["ver_obra", "ver_total", "agendar"]);
  assert.doesNotMatch(mensajes[1].body, /ver también Intermedio/);
  assert.deepEqual(vistos, ["intermedio"]);
  for (const b of mensajes[1].botones) assert.ok(b.title.length <= 20, b.title);
});

test("Carpintería: solo imagen general + lista con los 3 paquetes y agendar", () => {
  const { mensajes } = M.mensajesEstimado({ nombre: "Ana", m2: 50, tipo_proyecto: "Carpintería" }, { imageUrl: "u", paqueteElegido: null });
  assert.equal(mensajes[1].tipo, "lista");
  assert.equal(mensajes[1].filas.length, 4);
});

test("pedir detalle de otro paquete por botón y luego agendar llamada con lista de días/franjas", () => {
  const c = conversacion();
  Object.assign(c.vars, {});
  let vars = { paso: "post_estimado", nombre: "Ana Ruiz", ciudad: "Bogotá", tipo_proyecto: "Intermedio", presupuesto: "$30", conjunto_o_barrio: "X", m2: 50, plazo: "Inmediato", correo: "a@b.co", estimado_enviado: true, aviso_datos: true, paquetes_vistos: ["intermedio"], tibio_firma: "Ana Ruiz|Bogotá|Intermedio|$30" };
  const paso = (texto, opcion) => {
    const r = M.procesar(vars, { texto, opcionId: opcion || null, tieneMedia: false }, { perfil: "", ahora: AHORA });
    vars = { ...vars, ...r.vars };
    return r;
  };
  let r = paso("Ver Obra Blanca", "ver_obra");
  assert.deepEqual(r.acciones, [{ op: "detalle", paquete: "obra" }]);

  r = paso("Agendar sesión", "agendar");
  assert.deepEqual(r.acciones[0].botones.map((b) => b.id), ["ag_llamada", "ag_virtual", "ag_presencial"]);

  r = paso("Llamada", "ag_llamada");
  const dias = r.acciones[0].filas;
  assert.equal(dias.length, 6);
  assert.equal(dias[0].id, "d_2026-11-25"); // mañana miércoles
  assert.ok(!dias.some((d) => /domingo/i.test(d.title)), "sin domingos");

  r = paso(dias[0].title, dias[0].id);
  assert.equal(vars.fecha_llamada, "2026-11-25");
  assert.equal(r.acciones[0].tipo, "lista");

  r = paso("2 a 4 pm", "f_14");
  assert.equal(vars.hora_llamada, "2 a 4 pm");
  assert.equal(vars.paso, "agendado");
  const guardar = r.acciones.find((a) => a.op === "guardar_lead");
  assert.deepEqual(guardar.extra, { tipo_agendamiento: "llamada", fecha_llamada: "2026-11-25", hora_llamada: "2 a 4 pm" });
  assert.match(textos(r), /quedó agendada tu llamada para el \*miércoles 25 nov\*/);

  // Despues de agendado todo lo atiende la IA
  r = paso("y cuánto dura la obra?");
  assert.equal(r.edge, "desvio");
});

test("después del link: cambiar a llamada, pedir el link otra vez o cambiar a virtual se resuelve sin IA", () => {
  const base = { paso: "agendado_link", paso_agenda: "agendado_link", tipo_agendamiento: "reunion_presencial", nombre: "Yonathan Murillo", estimado_enviado: true, aviso_datos: true, ciudad: "Bogotá", tipo_proyecto: "Solo Obra Blanca", presupuesto: "$32", conjunto_o_barrio: "Centrik Town", m2: 40, banos: 2, plazo: "10 días", correo: "a@b.co", tibio_firma: "Yonathan Murillo|Bogotá|Solo Obra Blanca|$32" };
  let r = M.procesar(base, { texto: "Mejor virtual" }, { perfil: "", ahora: AHORA });
  assert.equal(r.edge, "esperar");
  assert.equal(r.vars.tipo_agendamiento, "reunion_virtual");
  assert.ok(r.acciones.some((a) => a.tipo === "cta"));
  r = M.procesar(base, { texto: "Y dónde puedo agendar ?" }, { perfil: "", ahora: AHORA });
  assert.ok(r.acciones.some((a) => a.tipo === "cta"), "reenvía el link");
  r = M.procesar(base, { texto: "Prefiero llamada" }, { perfil: "", ahora: AHORA });
  assert.equal(r.vars.paso, "llamada_dia");
  assert.equal(r.acciones[0].tipo, "lista");
  r = M.procesar(base, { texto: "ya agendé la virtual" }, { perfil: "", ahora: AHORA });
  assert.equal(r.vars.paso, "agendado", "confirmación, no reenvío del link");
  assert.ok(!r.acciones.some((a) => a.tipo === "cta"));
  r = M.procesar(base, { texto: "Oye y que es Espazios?" }, { perfil: "", ahora: AHORA });
  assert.equal(r.edge, "desvio");
  assert.equal(r.vars.last_user_input, "Oye y que es Espazios?", "el agente recibe el mensaje nuevo");
});

test("reconoce 'Bgta' y 'Quiero blanca'", () => {
  assert.equal(M.buscarCiudad("Está en Bgta"), "Bogotá");
  assert.equal(M.interpretarTipo("Quiero blanca", null), "Solo Obra Blanca");
});

test("reunión virtual comparte link de Calendar y guarda tipo_agendamiento", () => {
  let vars = { paso: "tipo_agendamiento", paso_agenda: "tipo_agendamiento", nombre: "Ana", estimado_enviado: true, aviso_datos: true };
  const r = M.procesar(vars, { texto: "Reunión virtual", opcionId: "ag_virtual" }, { perfil: "", ahora: AHORA });
  assert.equal(r.acciones[1].tipo, "cta");
  assert.match(r.acciones[1].url, /calendar\.google\.com/);
  assert.equal(r.vars.paso, "agendado_link");
});

test("desvío: pregunta en medio del perfilamiento va a la IA y al volver se repregunta lo mismo", () => {
  const c = conversacion();
  c.turno("Hola");
  c.turno("si");
  let r = c.turno("cuánto se demoran en hacer una obra?");
  assert.equal(r.edge, "desvio");
  assert.equal(r.acciones.length, 0, "el motor no manda nada; responde la IA");
  assert.match(c.vars.pregunta_pendiente, /ciudad/);
  r = c.turno(null); // vuelve del agente
  assert.equal(r.edge, "esperar");
  assert.match(textos(r), /para seguir con tu cotización/);
  assert.match(textos(r), /ciudad/);
});

test("dato + pregunta en el mismo mensaje: guarda el dato, la IA responde, sigue con el siguiente", () => {
  const c = conversacion();
  c.turno("Hola");
  c.turno("si");
  let r = c.turno("Bogotá. Ustedes trabajan en Bosa?");
  assert.equal(c.vars.ciudad, "Bogotá");
  assert.equal(r.edge, "desvio");
  r = c.turno(null);
  assert.equal(r.acciones[0].tipo, "lista"); // tipo de proyecto, no vuelve a preguntar ciudad
});

test("primer mensaje con el nombre: no confirma nombre de perfil equivocado", () => {
  const c = conversacion("Efren Cifuentes");
  const r = c.turno("Mi nombre es Orlando Cifuentes, me acaban de entregar un apartamento en Buenavista Living");
  assert.equal(c.vars.nombre, "Orlando Cifuentes");
  assert.match(r.acciones[0].body, /^Hola Orlando!/);
  assert.match(r.acciones[1].body, /Ley 1581/);
  assert.match(r.acciones[1].body, /ciudad/);
});

test("nombre de perfil no válido: pregunta abierta", () => {
  const c = conversacion("🏠✨");
  const r = c.turno("hola");
  assert.match(textos(r), /Con quién tengo el gusto\?$/);
  c.turno("Martha rodríguez");
  assert.equal(c.vars.nombre, "Martha Rodríguez");
});

test("corrigen el nombre del perfil", () => {
  const c = conversacion("Yonathan Murillo");
  c.turno("hola");
  c.turno("no, soy Laura, la esposa");
  assert.equal(c.vars.nombre, "Laura");
});

test("ciudad fuera de cobertura cierra con calidez y no sigue preguntando", () => {
  const c = conversacion();
  c.turno("hola"); c.turno("si");
  const r = c.turno("Medellín");
  assert.equal(c.vars.cerrado, "cerrar_cobertura");
  assert.match(textos(r), /no estamos llegando a Medellín/);
  assert.equal(M.procesar(c.vars, { texto: "ok gracias" }, { perfil: "", ahora: AHORA }).edge, "desvio");
});

test("ciudad solo carpintería + tipo distinto cierra; con Carpintería sigue", () => {
  const c = conversacion();
  c.turno("hola"); c.turno("si"); c.turno("Chía");
  let r = c.turno("Solo Obra Blanca", { opcion: "tp_obra" });
  assert.equal(c.vars.cerrado, "cerrar_cobertura_tipo");

  const d = conversacion();
  d.turno("hola"); d.turno("si"); d.turno("chia");
  r = d.turno("4");
  assert.equal(d.vars.tipo_proyecto, "Carpintería");
  assert.match(textos(r), /presupuesto/);
});

test("ciudad no reconocida: va al intérprete IA; sin resultado muestra la lista", () => {
  const c = conversacion();
  c.turno("hola"); c.turno("si");
  let r = c.turno("villa del rosario");
  assert.equal(r.edge, "interpretar");
  assert.equal(r.acciones.length, 0, "el intérprete no le escribe al cliente");
  assert.equal(c.vars.campo_interpretar, "ciudad");
  r = c.turno(null); // vuelve del intérprete sin resultado
  assert.equal(r.acciones[0].tipo, "lista");
  assert.ok(r.acciones[0].filas.length <= 10, "WhatsApp: máximo 10 filas");
  assert.equal(c.vars.paso, "ciudad_lista");
  c.turno("Otra ciudad", { opcion: "c_otra" });
  assert.equal(c.vars.cerrado, "cerrar_cobertura");
});

test("lista de ciudades -> municipio cercano -> segunda lista con los 10 municipios", () => {
  const c = conversacion();
  c.turno("hola"); c.turno("si"); c.turno("no sé cómo se llama");
  let r = c.turno("Municipio cercano", { opcion: "c_municipio" });
  assert.equal(c.vars.paso, "ciudad_municipio");
  assert.equal(r.acciones[0].filas.length, 10);
  r = c.turno("Sopó", { opcion: "c_sopo" });
  assert.equal(c.vars.ciudad, "Sopó");
  assert.equal(r.acciones[0].tipo, "lista"); // sigue con tipo de proyecto
});

// Criterios de aceptación de cobertura (confirmados por el usuario 2026-11-24):
// - Carpintería: Bogotá, Soacha y 10 municipios de la Sabana.
// - Solo Obra Blanca, Intermedio y Remodelación Total: solo Bogotá y Soacha.
test("criterios de cobertura por ciudad y tipo de proyecto", () => {
  const TIPOS = { "Carpintería": "tp_carpinteria", "Solo Obra Blanca": "tp_obra", "Intermedio": "tp_intermedio", "Remodelación Total": "tp_total" };
  const COMPLETA = ["Bogotá", "Kennedy", "Suba", "Soacha", "Ciudad Verde"];
  const SOLO_CARP = ["Chía", "Mosquera", "Madrid", "Cota", "Zipaquirá", "Cajicá", "La Calera", "Funza", "Facatativá", "Faca", "Sopó"];
  const FUERA = ["Tenjo", "Fusagasugá", "Medellín"];
  const califica = (ciudad, tipo) => {
    const c = conversacion();
    c.turno("hola"); c.turno("si"); c.turno(ciudad);
    if (!c.vars.cerrado) c.turno(tipo, { opcion: TIPOS[tipo] });
    return !c.vars.cerrado;
  };
  for (const ciudad of COMPLETA) for (const tipo of Object.keys(TIPOS)) assert.ok(califica(ciudad, tipo), `${ciudad} + ${tipo} debe calificar`);
  for (const ciudad of SOLO_CARP) {
    assert.ok(califica(ciudad, "Carpintería"), `${ciudad} + Carpintería debe calificar`);
    for (const tipo of ["Solo Obra Blanca", "Intermedio", "Remodelación Total"]) assert.ok(!califica(ciudad, tipo), `${ciudad} + ${tipo} NO debe calificar`);
  }
  for (const ciudad of FUERA) for (const tipo of Object.keys(TIPOS)) assert.ok(!califica(ciudad, tipo), `${ciudad} + ${tipo} NO debe calificar`);
});

test("objeción de presupuesto en 2 etapas", () => {
  const c = conversacion();
  c.turno("hola"); c.turno("si"); c.turno("Soacha"); c.turno("Intermedio", { opcion: "tp_intermedio" });
  let r = c.turno("8 millones");
  assert.equal(c.vars.presupuesto, "$8");
  assert.deepEqual(r.acciones.find((a) => a.tipo).botones.map((b) => b.id), ["ob1_si", "ob1_no"]);
  r = c.turno("No por ahora", { opcion: "ob1_no" });
  assert.deepEqual(r.acciones.find((a) => a.tipo).botones.map((b) => b.id), ["ob2_carp", "ob2_guardar"]);
  r = c.turno("Guardar contacto", { opcion: "ob2_guardar" });
  assert.equal(c.vars.cerrado, "cerrar_presupuesto");

  const d = conversacion();
  d.turno("hola"); d.turno("si"); d.turno("Bogotá"); d.turno("3"); d.turno("12");
  r = d.turno("si, puedo llegar a 18");
  assert.equal(d.vars.presupuesto, "$18");
  assert.match(textos(r), /conjunto o barrio/);
});

test("presupuesto: formatos y confusión con m2", () => {
  assert.deepEqual(M.interpretarPresupuesto("30"), { valor: 30 });
  assert.deepEqual(M.interpretarPresupuesto("$25.000.000"), { valor: 25 });
  assert.deepEqual(M.interpretarPresupuesto("veinticinco millones"), { valor: 25 });
  assert.deepEqual(M.interpretarPresupuesto("treinta y cinco millones"), { valor: 35 });
  assert.deepEqual(M.interpretarPresupuesto("entre 20 y 30 millones"), { rango: [20, 30] });
  assert.deepEqual(M.interpretarPresupuesto("40 m2"), { aclarar: "area" });
  assert.deepEqual(M.interpretarPresupuesto("40 metros"), { aclarar: "area" });
  assert.equal(M.interpretarPresupuesto("no sé todavía"), null);
});

test("presupuesto en rango pide confirmación con botones", () => {
  const c = conversacion();
  c.turno("hola"); c.turno("si"); c.turno("Bogotá"); c.turno("2");
  let r = c.turno("entre 20 y 30");
  assert.equal(r.acciones[0].tipo, "botones");
  assert.match(r.acciones[0].body, /alrededor de 20 millones/);
  c.turno("Sí, correcto", { opcion: "pc_si" });
  assert.equal(c.vars.presupuesto, "$20");
});

test("aclaración y segundo intento fallido pasa a la IA", () => {
  const c = conversacion();
  c.turno("hola"); c.turno("si"); c.turno("Bogotá"); c.turno("2"); c.turno("30"); c.turno("Porto 13");
  let r = c.turno("grande");
  assert.equal(r.edge, "esperar");
  assert.match(textos(r), /solo con el número/);
  r = c.turno("bastante grande la verdad");
  assert.equal(r.edge, "desvio");
});

test("m2 fuera de banda 31-44 no pregunta baños", () => {
  const c = conversacion();
  c.turno("hola"); c.turno("si"); c.turno("Bogotá"); c.turno("2"); c.turno("30"); c.turno("Porto 13");
  const r = c.turno("52");
  assert.equal(c.vars.m2, 52);
  assert.match(textos(r), /arrancar la obra/);
});

test("pedir hablar con una persona va a handoff", () => {
  const c = conversacion();
  c.turno("hola");
  const r = c.turno("quiero hablar con un asesor");
  assert.equal(r.edge, "humano");
});

test("festivos de Colombia 2026 (Ley Emiliani)", () => {
  const f = M.festivosColombia(2026);
  for (const d of ["2026-01-01", "2026-01-12", "2026-03-23", "2026-04-02", "2026-04-03", "2026-05-01", "2026-05-18", "2026-06-08", "2026-06-15", "2026-06-29", "2026-07-20", "2026-08-07", "2026-08-17", "2026-10-12", "2026-11-02", "2026-11-16", "2026-12-08", "2026-12-25"]) {
    assert.ok(f.has(d), d);
  }
  assert.equal(f.size, 18);
});

test("días disponibles saltan domingos y festivos", () => {
  const dias = M.diasDisponibles(new Date("2026-12-04T15:00:00Z"), 6); // viernes 4 dic
  assert.deepEqual(dias.map((d) => d.fecha), ["2026-12-05", "2026-12-07", "2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12"]);
});

test("entrada: junta mensajes nuevos y toma el id del botón", () => {
  const msgs = [
    { direction: "outbound", created_at: "2026-11-24T10:00:00-03:00", content: "pregunta" },
    { direction: "inbound", created_at: "2026-11-24T10:01:00-03:00", content: null, reply_option_id: "b_2", reply_option_title: "2 baños" },
  ];
  const { entrada, ultimoAt } = M.extraerEntrada(msgs, { ultimo_inbound_at: "2026-11-24T09:00:00-03:00" });
  assert.equal(entrada.opcionId, "b_2");
  assert.equal(entrada.texto, "2 baños");
  assert.equal(ultimoAt, "2026-11-24T10:01:00-03:00");
  assert.equal(M.extraerEntrada(msgs, { ultimo_inbound_at: ultimoAt }).entrada, null);
});

test("payloads de WhatsApp válidos (límites de Meta)", () => {
  const p = M.payloadMensaje({ tipo: "botones", headerImage: "https://i", body: "b", botones: [{ id: "a", title: "Reunión presencial larga" }] });
  assert.equal(p.interactive.header.image.link, "https://i");
  assert.ok(p.interactive.action.buttons[0].reply.title.length <= 20);
  const l = M.payloadMensaje({ tipo: "lista", body: "b", boton: "Ver", filas: [{ id: "x", title: "y", description: "z" }] });
  assert.equal(l.interactive.action.sections[0].rows[0].description, "z");
});

test("ningún mensaje del motor usa signos de apertura ¿ ¡", () => {
  const c = conversacion();
  const todos = [];
  for (const [t, o] of [["hola"], ["si"], ["Bogotá"], ["3", "tp_total"], ["8"], ["No", "ob1_no"], ["x"], ["Guardar contacto", "ob2_guardar"]]) {
    todos.push(textos(c.turno(t, { opcion: o })));
  }
  assert.doesNotMatch(todos.join("\n"), /[¿¡]/);
});

// ---------------------------------------------------------------------------
// Intérprete IA (opción A)
// ---------------------------------------------------------------------------
test("intérprete: 'obr banca' -> tipo_obra_blanca -> sigue con presupuesto", () => {
  const c = conversacion();
  c.turno("hola"); c.turno("si"); c.turno("Bogotá");
  let r = c.turno("obr banca");
  assert.equal(r.edge, "interpretar");
  assert.equal(c.vars.campo_interpretar, "tipo_proyecto");
  r = c.turno(null, { interprete: "tipo_obra_blanca" });
  assert.equal(c.vars.tipo_proyecto, "Solo Obra Blanca");
  assert.match(textos(r), /presupuesto/);
  assert.equal(c.vars.ultima_interpretacion, "tipo_proyecto:tipo_obra_blanca");
});

test("intérprete: ciudad mal escrita -> Soacha; 'otra ciudad' pide confirmar en lista (no cierra)", () => {
  const c = conversacion();
  c.turno("hola"); c.turno("si");
  c.turno("suacha");
  let r = c.turno(null, { interprete: "ciudad_soacha" });
  assert.equal(c.vars.ciudad, "Soacha");
  assert.equal(r.acciones[0].tipo, "lista"); // tipo de proyecto

  const d = conversacion();
  d.turno("hola"); d.turno("si"); d.turno("villa del rosario");
  r = d.turno(null, { interprete: "ciudad_otra" });
  assert.ok(!d.vars.cerrado, "no cierra sin confirmación");
  assert.equal(d.vars.paso, "ciudad_lista");
});

test("intérprete: municipio de la Sabana mal escrito queda en solo carpintería", () => {
  const c = conversacion();
  c.turno("hola"); c.turno("si"); c.turno("faccatativa");
  c.turno(null, { interprete: "ciudad_facatativa" });
  assert.equal(c.vars.ciudad, "Facatativá");
  c.turno("Remodelación Total", { opcion: "tp_total" });
  assert.equal(c.vars.cerrado, "cerrar_cobertura_tipo");
});

test("intérprete: 'no_es_respuesta' va a la IA de desvíos", () => {
  const c = conversacion();
  c.turno("hola"); c.turno("si"); c.turno("Bogotá");
  c.turno("ay ahorita estoy manejando");
  const r = c.turno(null, { interprete: "no_es_respuesta" });
  assert.equal(r.edge, "desvio");
  assert.match(c.vars.pregunta_pendiente, /Qué te gustaría hacer/);
});

test("intérprete: etiqueta de otro campo se rechaza y muestra la lista", () => {
  const c = conversacion();
  c.turno("hola"); c.turno("si"); c.turno("Bogotá");
  c.turno("el de lujo");
  const r = c.turno(null, { interprete: "ciudad_bogota" });
  assert.ok(!c.vars.tipo_proyecto);
  assert.equal(r.acciones[0].tipo, "lista");
  assert.match(r.acciones[0].body, /elige una de estas opciones/);
});

test("intérprete: después del estimado y al agendar", () => {
  let vars = { paso: "post_estimado", nombre: "Ana", ciudad: "Bogotá", tipo_proyecto: "Intermedio", presupuesto: "$30", conjunto_o_barrio: "X", m2: 50, plazo: "Inmediato", correo: "a@b.co", estimado_enviado: true, aviso_datos: true, paquetes_vistos: ["intermedio"], tibio_firma: "Ana|Bogotá|Intermedio|$30" };
  const paso = (texto, extra = {}) => {
    const r = M.procesar(vars, texto === null ? null : { texto, opcionId: null, tieneMedia: false }, { perfil: "", ahora: AHORA, resultadoInterprete: extra.interprete || null });
    vars = { ...vars, ...r.vars };
    return r;
  };
  let r = paso("muestrame el todo incluido");
  assert.equal(r.edge, "interpretar");
  r = paso(null, { interprete: "ver_remodelacion_total" });
  assert.deepEqual(r.acciones, [{ op: "detalle", paquete: "total" }]);

  r = paso("dale de una agendemos");
  assert.equal(vars.paso, "tipo_agendamiento");
  r = paso("virtul porfa");
  assert.equal(r.edge, "interpretar");
  r = paso(null, { interprete: "agenda_virtual" });
  assert.ok(r.acciones.some((a) => a.tipo === "cta"));
});

test("intérprete: si llega un mensaje nuevo mientras interpreta, se procesa el nuevo", () => {
  const c = conversacion();
  c.turno("hola"); c.turno("si"); c.turno("Bogotá");
  c.turno("obr banca");
  const r = c.turno("Intermedio", { opcion: "tp_intermedio" });
  assert.equal(c.vars.tipo_proyecto, "Intermedio");
  assert.equal(c.vars.interpretacion_pendiente, false);
});

test("lector de la decisión: usa campos explícitos, ignora el prompt con todas las etiquetas", () => {
  const desde = "2026-11-24T15:00:00Z";
  const evPrompt = { event_type: "decision_evaluated", created_at: "2026-11-24T15:00:01Z", payload: { prompt: "opciones: no_es_respuesta, ciudad_bogota, tipo_obra_blanca" } };
  assert.equal(M.resultadoInterpreteDe([evPrompt], desde), null);
  const ev = { event_type: "decision_evaluated", created_at: "2026-11-24T15:00:02Z", edge_label: "tipo_intermedio", payload: { prompt: "ciudad_bogota..." } };
  assert.equal(M.resultadoInterpreteDe([evPrompt, ev], desde), "tipo_intermedio");
  const viejo = { event_type: "decision_evaluated", created_at: "2026-11-24T14:00:00Z", edge_label: "tipo_carpinteria" };
  assert.equal(M.resultadoInterpreteDe([viejo], desde), null, "ignora decisiones anteriores");
  const delMotor = { event_type: "decision_evaluated", created_at: "2026-11-24T15:00:03Z", edge_label: "esperar" };
  assert.equal(M.resultadoInterpreteDe([delMotor, ev], desde), "tipo_intermedio", "ignora las decisiones del motor");
});

test("lector de la decisión: forma real del evento de Kapso (payload.selected_label, sin edge_label)", () => {
  // Copiado de la prueba real del 2026-11-24 ("Ogota"), sin el prompt.
  const desde = "2026-11-24T19:33:04.072Z";
  const real = {
    event_type: "decision_evaluated",
    created_at: "2026-11-24T16:33:05-03:00",
    payload: {
      reasoning: { model: "claude-haiku-5-5", prompt: "... no_es_respuesta ... ciudad_soacha ...", response: "ciudad_bogota", duration_ms: 677 },
      duration_ms: 698, selected_label: "ciudad_bogota", step_identifier: "interprete",
    },
  };
  assert.equal(M.resultadoInterpreteDe([real], desde), "ciudad_bogota");
  const soloRespuesta = { ...real, payload: { reasoning: { response: "ciudad_soacha" } } };
  assert.equal(M.resultadoInterpreteDe([soloRespuesta], desde), "ciudad_soacha");
  const delMotor = { event_type: "decision_evaluated", created_at: "2026-11-24T16:33:07-03:00", payload: { reasoning: { response: { next_edge: "esperar" } }, selected_label: "esperar" } };
  assert.equal(M.resultadoInterpreteDe([delMotor, real], desde), "ciudad_bogota");
});

// Lleva una conversación hasta la pregunta del día de la llamada.
function hastaDiaLlamada() {
  const c = conversacion("Yonathan Murillo");
  c.turno("Hola"); c.turno("Sip"); c.turno("Bogotá");
  c.turno("Carpintería", { opcion: "tp_carpinteria" });
  c.turno("35palos"); c.turno("Centrik Town"); c.turno("Cuarenta");
  c.turno("2 baños", { opcion: "b_2" }); c.turno("Ya mismo"); c.turno("y@gmail.com");
  c.vars.estimado_enviado = true; // lo marca el handler al enviar las imágenes
  c.turno("Quiero agendar");
  c.turno("Llamada", { opcion: "ag_llamada" });
  assert.equal(c.vars.paso, "llamada_dia");
  return c;
}

test("llamada: 'hoy' explica que el primer día es mañana y vuelve a mostrar los días (sin IA)", () => {
  const c = hastaDiaLlamada();
  const r = c.turno("Hoy");
  assert.equal(r.edge, "esperar");
  assert.match(textos(r), /para hoy ya no alcanzamos/);
  assert.equal(r.acciones[0].tipo, "lista");
  assert.equal(c.vars.paso, "llamada_dia");
});

test("llamada: '¿y a qué hora?' antes del día lo responde el motor (sin IA)", () => {
  const c = hastaDiaLlamada();
  const r = c.turno("Y a qué hora ?");
  assert.equal(r.edge, "esperar");
  assert.match(textos(r), /primero elige el día/);
});

test("llamada: día y hora en el mismo mensaje agenda de una vez", () => {
  const c = hastaDiaLlamada();
  const r = c.turno("Eh, quiero agendar para mañana 25 a las 3:00 p.m., por favor.");
  assert.equal(c.vars.paso, "agendado");
  assert.equal(c.vars.fecha_llamada, "2026-11-25");
  assert.equal(c.vars.hora_llamada, "2 a 4 pm");
  assert.match(textos(r), /quedó agendada tu llamada/);
  assert.ok(r.acciones.some((a) => a.op === "guardar_lead"));
});

test("llamada: el número del día no se confunde con la hora", () => {
  assert.equal(M.franjaEnTexto("el jueves 26"), null);
  assert.equal(M.franjaEnTexto("mañana 25 a las 3:00 p.m.").titulo, "2 a 4 pm");
  assert.equal(M.franjaEnTexto("el viernes a las 9").titulo, "8 a 10 am");
  assert.equal(M.franjaEnTexto("tipo 11am").titulo, "10 am a 12 m");
});

test("audio con transcripción de Kapso se procesa como texto", () => {
  const msgs = [{ direction: "inbound", created_at: "2026-11-24T19:41:47Z", message_type: "audio", has_media: true,
    content: "Audio attached (audio_5ea6.ogg) [Size: 19.1 KB | Type: audio/ogg] URL: https://x \n\nTranscript: Eh, quiero agendar para mañana 25 a las 3:00 p.m., por favor." }];
  const { entrada } = M.extraerEntrada(msgs, { ultimo_inbound_at: "2026-11-24T19:00:00Z" });
  assert.equal(entrada.texto, "Eh, quiero agendar para mañana 25 a las 3:00 p.m., por favor.");
  assert.equal(entrada.tieneMedia, false);
  const sinTranscripcion = [{ ...msgs[0], content: "[audio attached]" }];
  assert.equal(M.extraerEntrada(sinTranscripcion, { ultimo_inbound_at: "2026-11-24T19:00:00Z" }).entrada.tieneMedia, true);
});

test("intérprete: algo sin sentido en ciudad -> IA responde y luego se pregunta con la lista", () => {
  const c = conversacion();
  c.turno("hola"); c.turno("si");
  let r = c.turno("asdfg");
  assert.equal(r.edge, "interpretar");
  r = c.turno(null, { interprete: "no_es_respuesta" });
  assert.equal(r.edge, "desvio");
  r = c.turno(null);
  assert.equal(r.acciones[0].tipo, "lista");
  assert.equal(c.vars.paso, "ciudad_lista");
});

test("presupuesto 'Como treinta' no se trata como pregunta (no va a la IA)", () => {
  const c = conversacion();
  c.turno("hola"); c.turno("si"); c.turno("bta"); c.turno("Quiero total");
  const r = c.turno("Como treinta");
  assert.equal(c.vars.presupuesto, "$30");
  assert.equal(r.edge, "esperar");
  assert.match(textos(r), /conjunto o barrio/);
  assert.equal(M.procesar !== undefined, true);
});

test("conjunto: si solo repite la ciudad, se vuelve a preguntar; un barrio sí se acepta", () => {
  const c = conversacion();
  c.turno("hola"); c.turno("si"); c.turno("bta"); c.turno("Quiero total"); c.turno("30 millones");
  let r = c.turno("En Bogotá");
  assert.equal(c.vars.conjunto_o_barrio, undefined);
  assert.match(textos(r), /me refiero al conjunto o barrio/);
  r = c.turno("Bosa");
  assert.equal(c.vars.conjunto_o_barrio, "Bosa");
});

test("D1: crea la columna version una vez y marca cada fila con 'v3' (insert y update)", async () => {
  const sentencias = [];
  let existe = false;
  const db = {
    prepare(sql) {
      return {
        bind(...args) { this.args = args; return this; },
        async run() {
          sentencias.push({ sql, args: this.args });
          if (/ALTER TABLE/.test(sql) && sentencias.filter((x) => /ALTER/.test(x.sql)).length > 1) throw new Error("duplicate column name: version");
          if (/^INSERT/.test(sql)) existe = true;
        },
        async first() { return existe ? { telefono: "57300" } : null; },
      };
    },
  };
  const g = sandbox.__isa3.guardarEnD1;
  await g({ DB: db }, "leads_tibios_isa_v2", ["nombre", "ciudad"], { nombre: "Ana", ciudad: "Bogotá" }, "57300", "ana", "conv1");
  await g({ DB: db }, "leads_tibios_isa_v2", ["nombre", "ciudad"], { nombre: "Ana", ciudad: "Soacha" }, "57300", null, "conv1");
  const ins = sentencias.find((x) => /^INSERT/.test(x.sql));
  assert.match(ins.sql, /version/);
  assert.ok(ins.args.includes("v3"));
  const upd = sentencias.find((x) => /^UPDATE/.test(x.sql));
  assert.match(upd.sql, /version = \?/);
  assert.ok(upd.args.includes("v3"));
  assert.equal(sentencias.filter((x) => /ALTER/.test(x.sql)).length, 1, "el ALTER corre una sola vez por tabla");
});

test("retoma: lead tibio de v2 -> saluda de vuelta y sigue con lo que falta (conjunto)", () => {
  const c = conversacion("Ana Pérez");
  const r = c.turno("Hola", { leadPrevio: { telefono: "57300", nombre: "Ana Pérez", ciudad: "Bogotá", tipo_proyecto: "Remodelación Total", presupuesto: "$30", version: null } });
  assert.match(textos(r), /qué bueno tenerte de vuelta/);
  assert.match(textos(r), /conjunto o barrio/);
  assert.equal(c.vars.nombre, "Ana Pérez");
  assert.equal(c.vars.presupuesto, "$30");
  assert.equal(c.vars.retomado, true);
  assert.doesNotMatch(textos(r), /Hablo con/);
});

test("retoma: lead completo de v2 sin agendar -> genera el estimado de una vez", () => {
  const c = conversacion();
  const r = c.turno("hola", { leadPrevio: { nombre: "Luz Adriana", ciudad: "Bogota", tipo_proyecto: "Remodelacion completa", presupuesto: "30 millones",
    conjunto_o_barrio: "Bosa recreo", m2: "37.78", banos: 2, plazo: "Inmediato", correo: "Luz@Outlook.com" } });
  assert.equal(c.vars.m2, 38);
  assert.equal(c.vars.correo, "luz@outlook.com");
  assert.deepEqual(r.acciones.filter((a) => a.op).map((a) => a.op), ["guardar_tibio", "guardar_lead", "estimado"]);
});

test("retoma: lead que ya agendó -> saludo y queda en 'agendado' (no repregunta)", () => {
  const c = conversacion();
  const r = c.turno("hola", { leadPrevio: { nombre: "Yesid Pintor", ciudad: "Bogotá", tipo_proyecto: "Intermedio", presupuesto: "$25", correo: "y@x.com", tipo_agendamiento: "llamada" } });
  assert.equal(c.vars.paso, "agendado");
  assert.match(textos(r), /saludarte de nuevo/);
  const r2 = c.turno("tengo una pregunta sobre la garantía?");
  assert.equal(r2.edge, "desvio");
});

test("lead ya agendado que pide cotización con otro metraje: nuevo estimado sin IA (caso Yonathan)", () => {
  const c = conversacion();
  c.turno("hola", { leadPrevio: { nombre: "Yonathan Murillo", ciudad: "Bogotá", tipo_proyecto: "Intermedio", presupuesto: "$30",
    conjunto_o_barrio: "Porto 13", m2: "60", plazo: "Inmediato", correo: "y@x.com", tipo_agendamiento: "llamada" } });
  assert.equal(c.vars.paso, "agendado");
  let r = c.turno("Me puedes mandar cotización para apto de 38m2");
  assert.notEqual(r.edge, "desvio");
  assert.equal(c.vars.m2, 38);
  assert.equal(c.vars.paso, "banos"); // 38 m2 cae en 31-44: primero baños
  r = c.turno("2 baños", { opcion: "b_2" });
  assert.deepEqual(r.acciones.filter((a) => a.op).map((a) => a.op), ["guardar_lead", "estimado"]);
  // preguntas sobre la sesión siguen yendo a la IA
  const c2 = conversacion();
  c2.turno("hola", { leadPrevio: { nombre: "Ana", ciudad: "Bogotá", tipo_agendamiento: "llamada" } });
  assert.equal(c2.turno("cuándo me llaman para la cotización personalizada?").edge, "desvio");
  assert.equal(c2.turno("el precio incluye mano de obra?").edge, "desvio");
});

test("retoma: datos inválidos de la base se descartan y se vuelven a preguntar", () => {
  const c = conversacion("Pedro");
  const r = c.turno("hola", { leadPrevio: { nombre: "Pedro Gómez", ciudad: "xyz", presupuesto: "no sé" } });
  assert.equal(c.vars.ciudad, undefined);
  assert.equal(c.vars.presupuesto, undefined);
  assert.match(textos(r), /ciudad/);
});

test("sin lead previo: saludo normal", () => {
  const c = conversacion("Dago M L");
  const r = c.turno("Hola");
  assert.match(textos(r), /Hablo con Dago M L\?/);
});

// ---------------------------------------------------------------------------
// Seguimientos automaticos
// ---------------------------------------------------------------------------
import { DatabaseSync } from "node:sqlite";
// D1 de mentiras sobre SQLite en memoria (misma API que usa el motor).
function d1() {
  const db = new DatabaseSync(":memory:");
  return {
    raw: db,
    prepare(sql) {
      let args = [];
      const st = {
        bind: (...a) => { args = a.map((x) => (x === undefined ? null : x)); return st; },
        run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
        first: async () => db.prepare(sql).get(...args) || null,
        all: async () => ({ results: db.prepare(sql).all(...args) }),
      };
      return st;
    },
  };
}
const S = sandbox.__isa3;
const bogota = (d) => new Date(d).toLocaleString("sv-SE", { timeZone: "America/Bogota" }).slice(0, 16);

test("horas hábiles: 10 min, cruce de las 7pm, fin de semana y festivo", () => {
  assert.equal(bogota(S.sumarMinutosHabiles(new Date("2026-11-24T15:00:00Z"), 10)), "2026-11-24 10:10"); // martes 10am
  assert.equal(bogota(S.sumarMinutosHabiles(new Date("2026-11-24T23:55:00Z"), 10)), "2026-11-25 07:05"); // martes 6:55pm: 5 min hoy + 5 mañana
  assert.equal(bogota(S.sumarMinutosHabiles(new Date("2026-11-24T22:00:00Z"), 240)), "2026-11-25 09:00"); // 5pm + 4h: 2h hoy + 2h mañana
  assert.equal(bogota(S.sumarMinutosHabiles(new Date("2026-11-28T15:00:00Z"), 10)), "2026-11-30 07:10"); // sábado -> lunes
  assert.equal(bogota(S.sumarMinutosHabiles(new Date("2026-12-08T03:00:00Z"), 10)), "2026-12-09 07:10"); // 8 dic festivo
});

test("seguimiento dentro de 24h: repite la pregunta pendiente con botones; fuera de 24h usa plantilla", () => {
  const fila = { paso: "banos", intento: 0, ultimo_cliente_en: "2026-11-24T15:00:00Z", vars: JSON.stringify({ nombre: "Ana María", estimado_enviado: false }) };
  let s = clonar(S.mensajesSeguimiento(fila, new Date("2026-11-24T15:10:00Z")));
  assert.equal(s.intento, 1);
  assert.equal(s.dentro24h, true);
  assert.equal(s.mensajes[0].tipo, "botones");
  assert.match(s.mensajes[0].body, /^Ana, sigo por aquí pendiente 😊\n\n\*Cuántos baños/);
  assert.equal(bogota(s.proximo), "2026-11-24 14:10");

  s = clonar(S.mensajesSeguimiento({ ...fila, intento: 2 }, new Date("2026-11-26T15:00:00Z")));
  assert.equal(s.ultimo, true);
  assert.equal(s.proximo, null);
  assert.equal(s.mensajes[0].tipo, "plantilla");
  assert.equal(s.mensajes[0].nombre, "isa_seguimiento_precalificacion_final");
  assert.deepEqual(s.mensajes[0].params.map((p) => p.text), ["Ana", "cuántos baños tiene tu apartamento"]);
});

test("plantilla después del estimado: cotización_1 con referencia al proyecto", () => {
  const p = clonar(S.plantillaSeguimiento(1, "tipo_agendamiento", { nombre: "Luis", estimado_enviado: true, conjunto_o_barrio: "Porto 13" }));
  assert.equal(p.nombre, "isa_seguimiento_cotizacion_1");
  assert.deepEqual(p.params.map((x) => x.text), ["Luis", "tu proyecto en Porto 13", "el agendamiento de tu sesión"]);
  const pl = M.payloadMensaje(p);
  assert.equal(pl.type, "template");
  assert.equal(pl.template.components[0].parameters[0].parameter_name, "customer_name");
});

test("botones de la plantilla: 'Sí, continuar' repite la pregunta; 'Ahora no' pausa sin perder datos", () => {
  const c = conversacion("Dago M L");
  c.turno("hola"); c.turno("si"); c.turno("bogota");
  let r = c.turno("Sí, continuar");
  assert.equal(c.vars.paso, "tipo_proyecto");
  assert.equal(r.acciones[0].tipo, "lista");
  assert.match(r.acciones[0].body, /^listo! seguimos/);
  r = c.turno("Ahora no");
  assert.equal(c.vars.seguimiento_pausado, true);
  assert.equal(c.vars.ciudad, "Bogotá");
  assert.match(textos(r), /seguimos desde donde quedamos/);
  r = c.turno("Remodelación Total", { opcion: "tp_total" });
  assert.equal(c.vars.seguimiento_pausado, false);
  assert.equal(c.vars.tipo_proyecto, "Remodelación Total");
});

test("D1: el motor programa, reprograma y cancela; el tick envía y avanza los intentos", async () => {
  const db = d1();
  const enviados = [];
  const env = { DB: db, KAPSO_API_KEY: "x" };
  sandbox.fetch = async (url, init) => {
    if (String(url).includes("/workflow_executions/")) return { ok: true, json: async () => ({ data: { status: "waiting" } }) };
    enviados.push(JSON.parse(init.body));
    return { ok: true, text: async () => "" };
  };
  const base = { idLead: "57300", edge: "esperar", destino: { phoneNumberId: "1", to: "57300" }, conversationId: "c1", executionId: "e1" };
  const t0 = new Date("2026-11-24T15:00:00Z");
  await S.actualizarSeguimiento(env, { ...base, estado: { paso: "presupuesto", nombre: "Ana" }, ahora: t0, ultimoCliente: t0.toISOString() });
  let fila = db.raw.prepare("select * from isa3_seguimientos").get();
  assert.equal(fila.estado, "pendiente");
  assert.equal(bogota(fila.proximo_en), "2026-11-24 10:10");

  // antes de vencer no manda nada
  assert.equal((await S.tickSeguimientos(env, new Date("2026-11-24T15:05:00Z"), 20)).length, 0);
  // vence: intento 1
  let res = await S.tickSeguimientos(env, new Date("2026-11-24T15:11:00Z"), 20);
  assert.equal(res[0].resultado, "enviado");
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].to, "57300");
  assert.match(enviados[0].text.body, /Ana, sigo por aquí pendiente/);
  fila = db.raw.prepare("select * from isa3_seguimientos").get();
  assert.equal(fila.intento, 1);
  assert.equal(bogota(fila.proximo_en), "2026-11-24 14:11");

  // el cliente responde: vuelve a intento 0 y a 10 min
  const t1 = new Date("2026-11-24T16:00:00Z");
  await S.actualizarSeguimiento(env, { ...base, estado: { paso: "conjunto_o_barrio", nombre: "Ana" }, ahora: t1, ultimoCliente: t1.toISOString() });
  fila = db.raw.prepare("select * from isa3_seguimientos").get();
  assert.equal(fila.intento, 0);
  assert.equal(fila.paso, "conjunto_o_barrio");

  // intentos 2 y 3 (el 3 cierra la cadena)
  await S.tickSeguimientos(env, new Date("2026-11-24T16:11:00Z"), 20);
  await S.tickSeguimientos(env, new Date("2026-11-24T21:00:00Z"), 20);
  res = await S.tickSeguimientos(env, new Date("2026-11-25T21:00:00Z"), 20);
  assert.equal(res[0].intento, 3);
  fila = db.raw.prepare("select * from isa3_seguimientos").get();
  assert.equal(fila.estado, "cerrado");
  // mas de 24h sin que el cliente escriba: el ultimo va por plantilla
  assert.equal(enviados[enviados.length - 1].template.name, "isa_seguimiento_precalificacion_final");
  assert.equal((await S.tickSeguimientos(env, new Date("2026-12-10T21:00:00Z"), 20)).length, 0);

  // agendado o humano: se cancela
  await S.actualizarSeguimiento(env, { ...base, estado: { paso: "presupuesto" }, ahora: t1 });
  await S.actualizarSeguimiento(env, { ...base, estado: { paso: "agendado" }, ahora: t1 });
  assert.equal(db.raw.prepare("select estado from isa3_seguimientos").get().estado, "cancelado");
});

test("tick: fuera de horario hábil no envía nada", async () => {
  const db = d1();
  let enviados = 0;
  const env = { DB: db, KAPSO_API_KEY: "x" };
  sandbox.fetch = async () => { enviados++; return { ok: true, text: async () => "", json: async () => ({}) }; };
  await S.actualizarSeguimiento(env, { idLead: "1", edge: "esperar", destino: {}, executionId: "e", estado: { paso: "m2" }, ahora: new Date("2026-11-24T15:00:00Z") });
  assert.equal((await S.tickSeguimientos(env, new Date("2026-11-25T03:00:00Z"), 20)).length, 0); // 10pm
  assert.equal(enviados, 0);
});

test("tick: si la ejecución ya no está esperando, cancela sin enviar", async () => {
  const db = d1();
  let enviados = 0;
  const env = { DB: db, KAPSO_API_KEY: "x" };
  sandbox.fetch = async (url) => {
    if (String(url).includes("/workflow_executions/")) return { ok: true, json: async () => ({ data: { status: "handoff" } }) };
    enviados++;
    return { ok: true, text: async () => "" };
  };
  const t0 = new Date("2026-11-24T15:00:00Z");
  await S.actualizarSeguimiento(env, { idLead: "1", edge: "esperar", destino: {}, executionId: "e", estado: { paso: "m2" }, ahora: t0 });
  const res = await S.tickSeguimientos(env, new Date("2026-11-24T16:00:00Z"), 20);
  assert.equal(res[0].resultado, "cancelado");
  assert.equal(enviados, 0);
});
