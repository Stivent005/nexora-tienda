/* BACKEND: habla con Supabase (pedidos, productos, ajustes, puntos y ruleta).
   Sin configurar js/config.js funciona en "modo de prueba": todo se guarda solo en este navegador.
   Sesión del administrador: se guarda en sessionStorage (se borra al cerrar la pestaña). */

var Backend=(function(){
  var S=CONFIG.supabase||{},
      remote=!!(S.enabled===true&&S.url&&S.anonKey),
      secureCheckout=!!(remote&&S.secureCheckout===true),
      accountsReady=!!(remote&&secureCheckout),
      token=null,
      refreshT=null,
      customerUser=null,
      base=remote?(S.url||"").replace(/\/+$/ ,""):"",
      last={};

  try{
    var sv=JSON.parse(
      sessionStorage.getItem(
        ADMIN_PAGE?"tienda_ses":"tienda_customer_ses"
      )||"null"
    );

    if(sv&&sv.a){
      token=sv.a;
      refreshT=sv.r||null;

      if(!ADMIN_PAGE&&sv.u&&sv.u.id){
        customerUser={
          id:String(sv.u.id),
          email:String(sv.u.email||""),
          name:String(sv.u.name||"")
        };
      }
    }
  }catch(e){}

  function clearSession(){
    token=null;
    refreshT=null;
    customerUser=null;
    guardarSes();
  }

  function guardarSes(){
    try{
      if(token){
        sessionStorage.setItem(
          ADMIN_PAGE?"tienda_ses":"tienda_customer_ses",
          JSON.stringify({
            a:token,
            r:refreshT,
            u:customerUser
          })
        );
      }else{
        sessionStorage.removeItem(
          ADMIN_PAGE?"tienda_ses":"tienda_customer_ses"
        );
      }
    }catch(e){}
  }

  function authRequest(path,payload){
    return fetch(
      base+path,
      {
        method:"POST",
        headers:{
          apikey:S.anonKey,
          "Content-Type":"application/json"
        },
        body:JSON.stringify(payload||{})
      }
    )
    .then(function(r){
      return r.text().then(function(t){
        var j={};

        try{
          j=t?JSON.parse(t):{};
        }catch(e){}

        if(!r.ok)
          throw errorApi(r.status,t,path);

        return j;
      });
    });
  }

  function setCustomerSession(j){
    token=j.access_token;
    refreshT=j.refresh_token||null;

    var u=j.user||{};

    customerUser={
      id:String(u.id||""),
      email:String(u.email||""),
      name:String(
        (u.user_metadata||{}).full_name||""
      )
    };

    if(!customerUser.id)
      throw new Error(
        "Supabase no devolvio la identidad de la cuenta."
      );

    guardarSes();

    return customerUser;
  }

  function headers(extra){
    var h={
      apikey:S.anonKey,
      "Content-Type":"application/json"
    };

    var bearer=
      token||
      (/^eyJ/.test(S.anonKey||"")?S.anonKey:"");

    if(bearer)
      h.Authorization="Bearer "+bearer;

    return Object.assign(h,extra||{});
  }

  function refrescar(){
    if(!refreshT)
      return Promise.reject(
        new Error("sin refresco")
      );

    return fetch(
      base+"/auth/v1/token?grant_type=refresh_token",
      {
        method:"POST",
        headers:{
          apikey:S.anonKey,
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          refresh_token:refreshT
        })
      }
    )
    .then(function(r){
      return r.json().then(function(j){

        if(!r.ok||!j.access_token)
          throw new Error("sesión vencida");

        token=j.access_token;
        refreshT=j.refresh_token||refreshT;

        guardarSes();
      });
    });
  }

  function errorApi(status,text,path){
    var d={};

    try{
      d=JSON.parse(text)||{};
    }catch(e){}

    var e=new Error(
      d.message||
      text||
      ("HTTP error "+status)
    );

    e.name="SupabaseError";
    e.status=status;
    e.code=d.code||"";
    e.details=d.details||"";
    e.hint=d.hint||"";
    e.path=path;

    return e;
  }

  function catalogoGet(path){
    var intento=0;

    function consultar(){
      return call(
        "GET",
        path,
        null,
        null,
        false,
        6000
      ).catch(function(e){

        if(
          intento++===0&&
          (!e.status||e.status>=500)
        ){
          return new Promise(function(resolve){
            setTimeout(resolve,350);
          }).then(consultar);
        }

        throw e;
      });
    }

    return consultar();
  }

  function call(
    method,
    path,
    body,
    extra,
    reintento,
    timeoutMs
  ){
    if(!remote){
      var desactivado=new Error(
        "La conexión remota está desactivada en js/config.js."
      );

      desactivado.code="SUPABASE_DISABLED";

      return Promise.reject(desactivado);
    }

    var controller=
      timeoutMs&&
      typeof AbortController!=="undefined"
        ?new AbortController()
        :null;

    var requestOptions={
      method:method,
      headers:headers(extra),
      body:body?JSON.stringify(body):undefined
    };

    var timer;

    if(controller)
      requestOptions.signal=controller.signal;

    var request=fetch(
      base+path,
      requestOptions
    )
    .then(function(r){

      if(r.ok){

        return r.status===204
          ?null
          :r.text().then(function(t){

              if(!t)
                return null;

              try{
                return JSON.parse(t);
              }catch(e){

                var bad=new Error(
                  "Supabase devolvió una respuesta JSON no válida."
                );

                bad.code="INVALID_RESPONSE";
                bad.path=path;

                throw bad;
              }
            });
      }

      if(
        token&&
        r.status===401&&
        !reintento&&
        refreshT
      ){

        return refrescar()
          .then(function(){

            return call(
              method,
              path,
              body,
              extra,
              true,
              timeoutMs
            );
          })
          .catch(function(){

            clearSession();

            throw new Error(
              T("login.sesionVencida")
            );
          });
      }

      if(
        token&&
        (r.status===401||r.status===403)
      ){

        if(r.status===401)
          clearSession();

        throw new Error(
          T("login.sesionVencida")
        );
      }

      return r.text().then(function(t){
        throw errorApi(
          r.status,
          t,
          path
        );
      });
    })
    .catch(function(e){

      if(!e.status&&!e.code){
        e.code="NETWORK_ERROR";
        e.path=path;
      }

      throw e;
    });

    if(!timeoutMs)
      return request;

    return Promise.race([
      request,

      new Promise(function(resolve,reject){

        timer=setTimeout(function(){

          if(controller)
            controller.abort();

          var e=new Error(
            "La consulta a Supabase excedió el tiempo límite."
          );

          e.code="TIMEOUT";
          e.path=path;

          reject(e);

        },timeoutMs);
      })

    ]).finally(function(){
      clearTimeout(timer);
    });
  }

  function soloSi(rows){
    if(!rows||!rows.length){

      throw new Error(
        "No se pudo guardar el cambio. Vuelve a entrar al panel e inténtalo otra vez."
      );
    }
  }

  function rpcChecked(nombre,args){
    return call(
      "POST",
      "/rest/v1/rpc/"+nombre,
      args||{}
    )
    .then(function(r){

      if(r&&r.error){

        var e=new Error(
          String(r.error)
        );

        e.code="RPC_REJECTED";

        throw e;
      }

      return r;
    });
  }

  function aplicarRespuestaPedido(o,r){

    if(!r||!r.id)
      throw new Error(
        "El servidor no devolvió el número del pedido."
      );

    o.id=String(r.id);

    if(r.estado)
      o.estado=String(r.estado);

    if(r.total!==undefined)
      o.total=Number(r.total)||0;

    if(r.subtotal!==undefined)
      o.subtotal=Number(r.subtotal)||0;

    if(r.descuento!==undefined)
      o.descuento=Number(r.descuento)||0;

    if(Array.isArray(r.items))
      o.items=r.items;

    if(r.cupon!==undefined)
      o.cupon=String(r.cupon||"");

    if(r.creado){
      var fecha=Date.parse(r.creado);

      if(isFinite(fecha))
        o.fecha=fecha;
    }

    return r;
  }

  var MERGE={
    Prefer:"resolution=merge-duplicates,return=minimal"
  };

  return{

    remote:remote,

    secureCheckout:secureCheckout,

    accountsReady:accountsReady,

    ready:remote
      ?secureCheckout
      :enLocal,

    restore:function(){
      return remote&&!!token;
    },

    login:function(email,pass){

      if(!remote)
        return Promise.resolve();

      return fetch(
        base+"/auth/v1/token?grant_type=password",
        {
          method:"POST",
          headers:{
            apikey:S.anonKey,
            "Content-Type":"application/json"
          },
          body:JSON.stringify({
            email:email,
            password:pass
          })
        }
      )
      .then(function(r){

        return r.json().then(function(j){

          if(!r.ok||!j.access_token)
            throw new Error(
              T("login.credencialesMalas")
            );

          token=j.access_token;
          refreshT=j.refresh_token||null;
          customerUser=null;

          guardarSes();
        });
      });
    },

    customer:function(){
      return !ADMIN_PAGE&&accountsReady
        ?customerUser
        :null;
    },

    restoreCustomer:function(){
      return !ADMIN_PAGE&&
        accountsReady&&
        !!(
          token&&
          customerUser&&
          customerUser.id
        );
    },

    signupCustomer:function(
      name,
      email,
      pass
    ){

      if(!accountsReady)
        return Promise.reject(
          new Error(
            "El registro de clientes se habilita cuando la configuracion segura este lista."
          )
        );

      return authRequest(
        "/auth/v1/signup",
        {
          email:String(email||"")
            .trim()
            .toLowerCase(),

          password:String(pass||""),

          data:{
            full_name:String(name||"")
              .trim()
          }
        }
      )
      .then(function(j){

        if(j.access_token){

          return{
            user:setCustomerSession(j),
            requiresEmailConfirmation:false
          };

        }

        return{
          user:j.user||null,
          requiresEmailConfirmation:true
        };
      });
    },

    loginCustomer:function(
      email,
      pass
    ){

      if(!accountsReady)
        return Promise.reject(
          new Error(
            "El inicio de sesion de clientes se habilita cuando la configuracion segura este lista."
          )
        );

      return authRequest(
        "/auth/v1/token?grant_type=password",
        {
          email:String(email||"")
            .trim()
            .toLowerCase(),

          password:String(pass||"")
        }
      )
      .then(function(j){

        if(!j.access_token)
          throw new Error(
            "Correo o contrasena incorrectos."
          );

        return setCustomerSession(j);
      });
    },

    logoutCustomer:function(){

      var request=
        remote&&token
          ?call(
              "POST",
              "/auth/v1/logout",
              {}
            )
          :Promise.resolve();

      clearSession();

      return request.catch(function(){
        return null;
      });
    },

    myOrders:function(){

      if(!accountsReady||!customerUser)
        return Promise.reject(
          new Error(
            "Inicia sesion para consultar tus compras."
          )
        );

      return rpcChecked(
        "mis_pedidos",
        {}
      )
      .then(function(r){

        var rows=
          Array.isArray(r)
            ?r
            :(r&&Array.isArray(r.pedidos)
              ?r.pedidos
              :[]);

        return rows.map(normalizarPedido);
      });
    },

    logout:function(){
      clearSession();
    },

    rpc:function(nombre,args){
      return rpcChecked(
        nombre,
        args
      );
    },

    procesarPuntosPedido:function(pedidoId){

      return call(
        "POST",
        "/rest/v1/rpc/procesar_puntos_pedido",
        {
          p_pedido_id:String(
            pedidoId||""
          )
        }
      );
    },

    leer:function(tabla,q){

      return call(
        "GET",
        "/rest/v1/"+tabla+"?"+q
      );
    },

    catalogo:function(){

      return Promise.all([

        catalogoGet(
          "/rest/v1/productos?select=datos,activo&order=creado.asc&limit=1000"
        ),

        catalogoGet(
          "/rest/v1/ajustes?select=clave,valor"
        )

      ])
      .then(function(r){

        var a={};

        (r[1]||[]).forEach(function(x){
          a[x.clave]=x.valor;
        });

        var ps=(r[0]||[]).map(function(x){

          var d=
            (x.datos&&typeof x.datos==="object")
              ?Object.assign({},x.datos)
              :{};

          d.active=x.activo!==false;

          return limpiarProducto(d);
        });

        last={};

        ps.forEach(function(p){
          last[p.id]=JSON.stringify(p);
        });

        return{
          productos:ps,
          config:a.config,
          puntos:a.puntos,
          ruleta:a.ruleta
        };
      });
    },

    guardarProductos:function(list){

      var rows=[],
          ids={},
          nuevo={},
          stockChanges=[],
          baseline={};

      list.forEach(function(p){

        ids[p.id]=1;

        var objetivo=JSON.stringify(p),
            envio=Object.assign({},p),
            anterior=null;

        if(
          secureCheckout&&
          last[p.id]
        ){

          try{
            anterior=JSON.parse(
              last[p.id]
            );
          }catch(e){
            anterior=null;
          }

          if(
            anterior&&
            Number(anterior.stock)!==
            Number(p.stock)
          ){

            envio.stock=anterior.stock;

            stockChanges.push({
              id:String(p.id),
              stock:Math.floor(
                Number(p.stock)||0
              ),
              producto:p
            });
          }
        }

        var s=JSON.stringify(envio);

        nuevo[p.id]=objetivo;
        baseline[p.id]=s;

        if(last[p.id]!==s){

          rows.push({
            id:p.id,
            datos:envio,
            activo:p.active!==false
          });
        }
      });

      var quitar=secureCheckout
        ?[]
        :Object.keys(last).filter(function(id){
            return !ids[id]&&
              /^[A-Za-z0-9_-]+$/.test(id);
          });

      var p1=rows.length
        ?call(
            "POST",
            "/rest/v1/productos",
            rows,
            MERGE
          )
        :Promise.resolve();

      return p1

        .then(function(){

          Object.keys(baseline)
            .forEach(function(id){
              last[id]=baseline[id];
            });

          return stockChanges.reduce(
            function(chain,change){

              return chain.then(function(){

                return rpcChecked(
                  "admin_ajustar_stock",
                  {
                    p_producto_id:change.id,
                    p_stock:change.stock,
                    p_motivo:"correccion"
                  }
                )
                .then(function(){

                  last[change.id]=
                    JSON.stringify(
                      change.producto
                    );

                });

              });

            },
            Promise.resolve()
          );
        })

        .then(function(){

          return quitar.length

            ?call(
                "DELETE",
                "/rest/v1/productos?id=in.("+quitar.join(",")+")",
                null,
                {
                  Prefer:"return=minimal"
                }
              )

            :null;

        })

        .then(function(){
          last=nuevo;
        });
    },

    guardarAjuste:function(
      clave,
      valor
    ){

      return call(
        "POST",
        "/rest/v1/ajustes",
        [
          {
            clave:clave,
            valor:valor
          }
        ],
        MERGE
      );
    },

    ruletaAdmin:function(){

      return call(
        "GET",
        "/rest/v1/catalogo_premios?select=id,nombre,descripcion,tipo,valor,peso,stock,activo&order=id.asc"
      );
    },

    premiosCanje:function(){

      return call(
        "GET",
        "/rest/v1/premios?select=id,nombre,descripcion,costo_puntos,stock,activo&order=costo_puntos.asc,id.asc"
      );
    },

    canjesAdmin:function(){

      return call(
        "GET",
        "/rest/v1/canjes?select=id,ff_id,nombre,costo,origen,estado,creado&order=creado.desc&limit=100"
      );
    },

    clientesPuntos:function(){

      return call(
        "GET",
        "/rest/v1/puntos?select=ff_id,puntos,total_ganado,pin_definido,actualizado&order=puntos.desc&limit=100"
      );
    },

    girosAdmin:function(){

      return call(
        "GET",
        "/rest/v1/giros?select=id,ff_id,premio,puntos_ganados,costo,creado&order=creado.desc&limit=50"
      );
    },

    guardarRuleta:function(lista){

      return call(
        "POST",
        "/rest/v1/rpc/admin_guardar_ruleta",
        {
          p_premios:lista
        }
      );
    },

    guardarPremioCanje:function(p){

      return call(
        "POST",
        "/rest/v1/rpc/admin_guardar_premio_canje",
        {
          p_id:p.id||null,
          p_nombre:String(
            p.nombre||""
          ).trim(),

          p_descripcion:String(
            p.descripcion||""
          ).trim(),

          p_costo:Math.floor(
            Number(p.costo)||0
          ),

          p_stock:
            (p.stock===""||p.stock==null)
              ?null
              :Math.floor(
                  Number(p.stock)
                ),

          p_activo:p.activo!==false
        }
      );
    },

    borrarPremioCanje:function(id){

      return call(
        "POST",
        "/rest/v1/rpc/admin_borrar_premio_canje",
        {
          p_id:id
        }
      );
    },

    estadoCanje:function(
      id,
      estado
    ){

      return call(
        "POST",
        "/rest/v1/rpc/admin_estado_canje",
        {
          p_id:id,
          p_estado:estado
        }
      );
    },

    crear:function(o){

      /* ----------------------------------------------------
         MODO LOCAL
      ---------------------------------------------------- */

      if(!remote){

        var l=lsGet(
          "tienda_pedidos",
          []
        );

        l.unshift(o);

        return lsSet(
          "tienda_pedidos",
          l
        )

        ?Promise.resolve()

        :Promise.reject(
            new Error(
              "No hay espacio en el navegador."
            )
          );
      }


      /* ----------------------------------------------------
         CHECKOUT SEGURO
      ---------------------------------------------------- */

      if(secureCheckout){

        /*
         * El checkout seguro no confía en:
         * - precio
         * - subtotal
         * - total
         * - stock
         *
         * Supabase los recalcula.
         */

        var datosPedido={
          idempotencyKey:String(
            o.idempotencyKey||
            (
              "nexora-"+Date.now()+"-"+Math.random()
            )
          ),

          items:Array.isArray(o.items)
            ?o.items.map(function(item){
                return{
                  id:String(
                    item.id||item.productoId||""
                  ),
                  q:Math.max(
                    1,
                    Math.floor(
                      Number(
                        item.q||
                        item.cantidad||
                        1
                      )
                    )
                  )
                };
            })
            :[],

          nombre:String(
            o.nombre||
            (o.cliente&&o.cliente.nombre)||
            ""
          ).trim(),

          tel:String(
            o.tel||
            o.telefono||
            ""
          ).trim(),

          cliente:o.cliente||{
            nombre:String(
              o.nombre||""
            ).trim()
          },

          direccion:o.direccion||{},

          entrega:o.entrega||{},

          pago:String(
            o.pago||""
          )
        };


        if(!datosPedido.nombre){

          return Promise.reject(
            new Error(
              "Falta el nombre del cliente."
            )
          );
        }


        if(
          !datosPedido.items.length
        ){

          return Promise.reject(
            new Error(
              "El pedido no contiene productos."
            )
          );
        }


        return rpcChecked(
          "crear_pedido_seguro",
          {
            p_datos:datosPedido
          }
        )
        .then(function(r){

          aplicarRespuestaPedido(
            o,
            r
          );

          return r;
        });
      }


      /* ----------------------------------------------------
         CHECKOUT REMOTO INSEGURO BLOQUEADO
      ---------------------------------------------------- */

      return Promise.reject(
        Object.assign(
          new Error(
            "Checkout remoto bloqueado: primero activa y verifica el checkout seguro."
          ),
          {
            code:"SECURE_CHECKOUT_REQUIRED"
          }
        )
      );
    },

    listar:function(){

      if(!remote){

        return Promise.resolve(
          lsGet(
            "tienda_pedidos",
            []
          ).map(normalizarPedido)
        );
      }

      var pedidoReq=call(
        "GET",
        "/rest/v1/pedidos?select=id,estado,creado,datos&order=creado.desc&limit=500"
      );

      if(!secureCheckout){

        return pedidoReq.then(function(rows){

          return(
            rows||[]
          ).map(normalizarPedido);

        });
      }

      return Promise.all([

        pedidoReq,

        call(
          "GET",
          "/rest/v1/pagos_abonos?select=id,pedido_id,monto,estado,metodo,referencia,comprobante,creado,nota_admin&order=creado.asc&limit=1000"
        ),

        call(
          "GET",
          "/rest/v1/pagos_reintegros?select=id,abono_id,monto,estado,metodo,referencia,comprobante,creado,nota_admin&order=creado.asc&limit=1000"
        ),

        call(
          "GET",
          "/rest/v1/pedido_entregas?select=id,pedido_id,producto_id,tipo,cantidad,estado,datos_entrega&order=id.asc&limit=1000"
        )

      ])
      .then(function(res){

        var pedidos=
          (res[0]||[])
            .map(normalizarPedido),

            porId={},
            porAbono={};

        pedidos.forEach(function(o){

          o.abonos=[];
          o.entregas=[];

          porId[o.id]=o;
        });

        (res[1]||[])
          .forEach(function(a){

            var o=
              porId[
                String(a.pedido_id)
              ];

            var abono={
              id:Number(a.id),
              monto:Number(a.monto)||0,
              estado:String(
                a.estado||"pendiente"
              ),
              metodo:String(
                a.metodo||""
              ),
              referencia:String(
                a.referencia||""
              ),
              comprobante:String(
                a.comprobante||""
              ),
              fecha:
                Date.parse(a.creado)||0,
              nota:String(
                a.nota_admin||""
              ),
              reintegros:[]
            };

            if(o){

              o.abonos.push(
                abono
              );

              porAbono[
                abono.id
              ]=abono;
            }
          });

        (res[2]||[])
          .forEach(function(r){

            var a=
              porAbono[
                Number(r.abono_id)
              ];

            if(a){

              a.reintegros.push({

                id:Number(r.id),

                monto:
                  Number(r.monto)||0,

                estado:String(
                  r.estado||"pendiente"
                ),

                metodo:String(
                  r.metodo||""
                ),

                referencia:String(
                  r.referencia||""
                ),

                comprobante:String(
                  r.comprobante||""
                ),

                fecha:
                  Date.parse(r.creado)||0,

                nota:String(
                  r.nota_admin||""
                )
              });
            }
          });

        (res[3]||[])
          .forEach(function(d){

            var o=
              porId[
                String(d.pedido_id)
              ];

            if(o){

              o.entregas.push({

                id:Number(d.id),

                productoId:String(
                  d.producto_id||""
                ),

                tipo:String(
                  d.tipo||"fisico"
                ),

                cantidad:Number(
                  d.cantidad
                )||0,

                estado:String(
                  d.estado||
                  "pendiente"
                ),

                datos:
                  d.datos_entrega||{}
              });
            }
          });

        return pedidos;
      });
    },

    actualizar:function(o){

      if(
        remote&&
        secureCheckout
      ){

        return Promise.reject(
          new Error(
            "Los cambios de estado deben hacerse desde Pagos o Entregas para conservar inventario y auditoría."
          )
        );
      }

      if(!remote){

        var l=lsGet(
          "tienda_pedidos",
          []
        );

        var i=l.findIndex(function(x){
          return x.id===o.id;
        });

        if(i>-1)
          l[i]=o;

        lsSet(
          "tienda_pedidos",
          l
        );

        return Promise.resolve();
      }

      return call(
        "PATCH",
        "/rest/v1/pedidos?id=eq."+encodeURIComponent(o.id),
        {
          estado:o.estado,
          datos:o
        },
        {
          Prefer:"return=representation"
        }
      )
      .then(soloSi);
    },

    eliminar:function(id){

      if(
        remote&&
        secureCheckout
      ){

        return rpcChecked(
          "admin_borrar_pedido",
          {
            p_pedido_id:String(id)
          }
        ).then(function(r){
          if(!r||r.ok!==true){
            throw new Error(
              (r&&r.error)||
              "El servidor no pudo eliminar el pedido."
            );
          }
          return r;
        });
      }

      if(!remote){

        lsSet(
          "tienda_pedidos",
          lsGet(
            "tienda_pedidos",
            []
          ).filter(function(x){
            return x.id!==id;
          })
        );

        return Promise.resolve();
      }

      return call(
        "DELETE",
        "/rest/v1/pedidos?id=eq."+encodeURIComponent(id),
        null,
        {
          Prefer:"return=representation"
        }
      )
      .then(soloSi);
    },

    cambiarEstadoPedido:function(
      id,
      estado,
      motivo
    ){

      return rpcChecked(
        "admin_cambiar_estado_pedido",
        {
          p_pedido_id:String(id),
          p_estado:String(estado),
          p_motivo:String(
            motivo||""
          )
        }
      );
    },

    confirmarPagoCompleto:function(
      id,
      monto,
      metodo,
      referencia,
      comprobante,
      nota
    ){

      return rpcChecked(
        "admin_confirmar_pago_pedido",
        {
          p_pedido_id:String(id),
          p_monto:Number(monto),
          p_metodo:String(
            metodo||"Pago manual"
          ),
          p_referencia:String(
            referencia||""
          ),
          p_comprobante:String(
            comprobante||""
          ),
          p_nota:String(
            nota||""
          )
        }
      );
    },

    verificarAbono:function(
      id,
      aprobar,
      nota
    ){

      return rpcChecked(
        "admin_verificar_abono",
        {
          p_abono_id:Number(id),
          p_aprobar:!!aprobar,
          p_nota:String(
            nota||""
          )
        }
      );
    },

    registrarReintegro:function(
      id,
      monto,
      metodo,
      referencia,
      comprobante,
      nota
    ){

      return rpcChecked(
        "admin_registrar_reintegro",
        {
          p_abono_id:Number(id),
          p_monto:Number(monto),
          p_metodo:String(
            metodo||"Reintegro manual"
          ),
          p_referencia:String(
            referencia||""
          ),
          p_comprobante:String(
            comprobante||""
          ),
          p_nota:String(
            nota||""
          )
        }
      );
    },

    verificarReintegro:function(
      id,
      aprobar,
      nota
    ){

      return rpcChecked(
        "admin_verificar_reintegro",
        {
          p_reintegro_id:Number(id),
          p_aprobar:!!aprobar,
          p_nota:String(
            nota||""
          )
        }
      );
    },

    verificarReintegrosPedido:function(
      id,
      aprobar,
      nota
    ){

      return rpcChecked(
        "admin_verificar_reintegros_pedido",
        {
          p_pedido_id:String(id),
          p_aprobar:!!aprobar,
          p_nota:String(
            nota||""
          )
        }
      );
    },

    actualizarEntrega:function(
      id,
      estado,
      datos
    ){

      return rpcChecked(
        "admin_actualizar_entrega",
        {
          p_entrega_id:Number(id),
          p_estado:String(estado),
          p_datos_entrega:datos||{}
        }
      );
    },

    ajustarStock:function(
      id,
      stock,
      motivo
    ){

      return rpcChecked(
        "admin_ajustar_stock",
        {
          p_producto_id:String(id),
          p_stock:Math.floor(
            Number(stock)
          ),
          p_motivo:String(
            motivo||"correccion"
          )
        }
      );
    }

  };
})();