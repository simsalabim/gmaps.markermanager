/**
 * @name GmapsMarkerManager
 * @version 0.2
 * @author Alexander Kaupanin <kaupanin@gmail.com>
 *
 * @fileoverview GmapsMarkerManager - интерфейс для добавления маркеров на карту; маркеры, располагающиеся в непосредственной близости друг от друга на
 * <i>отображаемой карте</i>, объёдиняются в группы и показывается один групповой маркер. При изменении масштаба происходит пересчёт сетки, маркеры разбиваются
 * на новые группы (или объединяются)
 * 
 * <b>Как работает</b>:
 * GmapsMarkerManager располагает свои маркеры на сетке, аналогичной тайлам карты. Когда пользователь изменяет видимую область, происходит пересчёт ячеек 
 * и соответственно группировка-разгруппировка маркеров в видимй области и на небольшой площади за её пределами ()
 */


/**
 * Создаёт экземпляр  GmapsMarkerManager для добавления/удаления маркеров
 *
 * @constructor
 * @param {Map} map карта
 * @param {Object} options объект дополнительных опций:
 *   {Object} cell объект ячейки с её размерами: {width: 48, height: 96}
 *   {Object} icon объект иконки, показываемой для группы маркеров: {src: "/img/icons/group_marker.png", shadow: "/img/icons/group_marker_shadow.png"}
 *   {Number} threshold уровень приближения карты (zoom), при котором не нужно группировать маркеры
 *   {Float} sanity  1.5  "пределы разумного" - коэффициент, который используется для расчёта группировки за пределами видимой области, по умолчанию 1.5
 *           это значит что для видимой области размерами 200х100 sanity-область будет в 1.5 раз больше по каждому измерению, с видимой областью по центу
 *           см. рисунок
 *                                                  _____________300_______________
 *                                                 |       _______200_______      |
 *                                                 |      |                 |     |
 *                                                150    100    viewport    |     |
 *                                                 |      |_________________|     |
 *                                                 |______________________________|
 */
function GmapsMarkerManager(map, options){
  this.options = options || {};
  this.marker_size = new google.maps.Size(16, 32);
  this.setMap(map);
  this.map = map;
  
  this.markers = new Array();
  this.markers_infowindows = new Array();
  
  this.view_port = new Object();
  this.view_port.cell = new Object();
  this.view_port.cells = new Array();
  this.view_port.markers = new Array();
  this.view_port.cell.width = this.options.cell ? (this.options.cell.width || false) : this.marker_size.width * 3.0;
  this.view_port.cell.height = this.options.cell ? (this.options.cell.height || false) : this.marker_size.height * 3.0;
  this.view_port.height = this.map.getDiv().offsetHeight; 
  this.view_port.width = this.map.getDiv().offsetWidth;
  this.view_port.cols_count = Math.ceil(this.view_port.width / this.view_port.cell.width);
  this.view_port.rows_count = Math.ceil(this.view_port.height / this.view_port.cell.height);
  this.initial = true;
  this.on_zoom = false;
  
  this.threshold_zoom = this.options.threshold || 12;
  
  this.group_icon_src = this.options.icon ? (this.options.icon.src || false) : false;
  this.group_icon_shadow = this.options.icon ? (this.options.icon.shadow || false) : false;
  
  this.grid = new Object();
  this.grid.cells = new Array();
  this.grid.markers = new Array();
}


GmapsMarkerManager.prototype = new google.maps.OverlayView();


/**
 * Добавить маркер
 *
 * @param {Marker} marker маркер
 * @param {Infowindow} infowindow информационное окно (опционально), показывается при наведении на маркер
 */
GmapsMarkerManager.prototype.addMarker = function(marker, infowindow){
  infowindow = infowindow || false;
  this.markers.push(marker);
  this.markers_infowindows.push(infowindow);
}


/**
 * Удалить маркер
 *
 * @param {Integer} index индекс удаляемого маркера в массиве
 */
GmapsMarkerManager.prototype.removeMarkerByNumber = function(index){
  this.markers[index].setMap(null);
  this.markers.splice(index, 1);
  this.initial = true;
  this.draw();
}


/**
 * Очистить карту от маркеров
 *
 * @param {Boolean} remove удалить ли маркеры из менеджера
 */
GmapsMarkerManager.prototype.clear = function(remove){
  for (var i in this.markers) {
    if (typeof this.markers[i] == 'object') {
      this.markers[i].setMap(null); // ie fix
    }
  }
  if(remove) this.markers = new Array();
}


/**
 * Перересовка маркеров и карты при начальной загрузке и изменении зума.
 */
GmapsMarkerManager.prototype.draw = function(){
  if (this.initial) {
    this.refresh();
  }
  var me = this;
  google.maps.event.addListener(this.map, "zoom_changed", function() {
    me.initial = true;
  }); 
}


/**
 * Обновить карту (очистка, построение сетки, расчёт маркеров по сетке и их группировка-отображение)
 */
GmapsMarkerManager.prototype.refresh = function(){
  this.clear();
  this.clearGroupMarkers();
  this.buildMapGrid(this.initial);
  this.checkMarkers(this.markers, this.view_port.cells);
  this.groupMarkers();
  this.initial = false;
}


/**
 * Очистить карту от групповых маркеров
 *
 * @param {Boolean} remove удалить ли маркеры из вьюпорта
 */
GmapsMarkerManager.prototype.clearGroupMarkers = function(remove){
  for (var i = 0; i < this.view_port.markers.length; i++) {
    if(this.view_port.markers[i].alias) {
      this.view_port.markers[i].alias.setMap(null);
    }
  }
  if (remove) {
    this.view_port.markers = new Array();
  }
  return true;
}


/**
 * Построить расчётную сетку
 *
 * @param {Boolean} force
 */
GmapsMarkerManager.prototype.buildMapGrid = function(force){
  force = force || false;
  this.view_port.cells = this.buildGrid(this.calculateGridOptParams(this.markers));
  for (var i = 0; i < this.view_port.cells.length; i++) {
    if(typeof this.view_port.markers[i] == 'undefined' || force) {
      this.view_port.markers[i] = new Object();
    }  
  }
}


/**
 * Получить опции для расчётной сетки
 *
 * @param {Array} markers
 */
GmapsMarkerManager.prototype.calculateGridOptParams = function(markers){
  this.sanity = this.options.sanity || 1.5;
  var grid_params = {
    start: {
        x: 0 - this.view_port.width * this.sanity,
        y: 0 - this.view_port.height * this.sanity
    },
    end: {
        x: this.view_port.width + this.view_port.width * this.sanity,
        y: this.view_port.height + this.view_port.height * this.sanity
    },
    cell: {
        width: this.view_port.cell.width,
        height: this.view_port.cell.height
    }           
  }
  return grid_params;
}


/**
 * Строим расчётную тайловую сетку
 *
 * @param {Object} params: {
 *                           start: {
 *                             x: -300,
 *                             y: -150
 *                           },
 *                           end: {
 *                             x: 500,
 *                             y: 250
 *                           },
 *                           cell: {
 *                             width: 48,
 *                             height: 96
 *                           }
 *                         }
 */
GmapsMarkerManager.prototype.buildGrid = function(params){
  var cells = new Array();
  for (var i = params.start.x; i < params.end.x; i += params.cell.width) {
    for (var j = params.start.y; j < params.end.y; j += params.cell.height) {
      cells.push(new google.maps.LatLngBounds(this.getProjection().fromDivPixelToLatLng(new google.maps.Point(i, j + params.cell.height)),
                                              this.getProjection().fromDivPixelToLatLng(new google.maps.Point(i + params.cell.width, j)))
                                            );
    }
  }
  return cells;
}


/**
 * Проверка маркеров на вхождение в ячейки расчётной сетки
 *
 * @param {Array} markers массив маркеров карты
 * @param {Array} cells массив ячеек расчётной сетки
 */
GmapsMarkerManager.prototype.checkMarkers = function(markers, cells){
  for(var i = 0; i < cells.length; i++) {
    this.view_port.markers[i].count = 0;
    this.view_port.markers[i].items = new Array();
    this.view_port.markers[i].bounds = cells[i];
    
    for (var j = 0; j < markers.length; j++) {
      if (cells[i].contains(markers[j].getPosition())) {
        this.view_port.markers[i].count++;
        this.view_port.markers[i].items.push(markers[j]);
      }
    }
  }
  return true;
}


/**
 * Группировка маркеров по ячейкам расчётной сетки
 */
GmapsMarkerManager.prototype.groupMarkers = function(){
  this.threshold = this.map.getZoom() >= this.threshold_zoom ? true : false;
  
  var infowindow_baloon = infowindow_baloon || new google.maps.InfoWindow();
  
  for (var i = 0; i < this.view_port.markers.length; i++) {
    if(this.view_port.markers[i].count && !this.view_port.markers[i].alias){
      me = this;
      
      if (this.threshold) {
        for (var j = 0; j < this.view_port.markers[i].items.length; j++) {
          this.view_port.markers[i].items[j].setMap(this.map);
          google.maps.event.addListener(this.view_port.markers[i].items[j], "click", function(){
            if (me.markers_infowindows[i]) {
              infowindow_baloon.setContent(this.markers_infowindows[i]);
              infowindow_baloon.open(me.map, this);
            }
          });
        }
      } else {
        for(var j = 0; j < this.view_port.markers[i].items.length; j++) {
          this.view_port.markers[i].items[j].setMap(null);
        }  
      
        if (this.view_port.markers[i].count == 1) {
          this.view_port.markers[i].alias = this.view_port.markers[i].items[0];
          this.view_port.markers[i].alias.setMap(this.map);
          
          google.maps.event.addListener(this.view_port.markers[i].alias, "click", function(){
            if (me.markers_infowindows[i]) {
              infowindow_baloon.setContent(this.markers_infowindows[i]);
              infowindow_baloon.open(me.map, this);
            }
          });
        }
        else {
          this.view_port.markers[i].alias = new google.maps.Marker({
            position: this.view_port.markers[i].items[0].getPosition(),
            title: this.view_port.markers[i].count.toString()
          });
          
          if (this.group_icon_src) {
            this.view_port.markers[i].alias.setIcon(new google.maps.MarkerImage(this.group_icon_src));
          }  
          if (this.group_icon_shadow) {
            this.view_port.markers[i].alias.setShadow(new google.maps.MarkerImage(this.group_icon_shadow));
          }
          this.view_port.markers[i].alias.setMap(this.map);
        }
      }
    }    
  }
}
