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
    const r = M.procesar(vars, entrada, { perfil, ahora: AHORA });
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

test("ciudad no reconocida: pasa a lista de ciudades", () => {
  const c = conversacion();
  c.turno("hola"); c.turno("si");
  const r = c.turno("villa del rosario");
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
