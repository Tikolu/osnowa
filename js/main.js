// Import maplibre-gl
import "https://unpkg.com/maplibre-gl/dist/maplibre-gl.js"
import sleep from "./util/sleep.js"

// Create map
const map = new maplibregl.Map({
	container: "mapContainer",
	style: "https://tiles.openfreemap.org/styles/bright",
	center: [90, 0],
	zoom: 0.1
})

// View transition polyfill
document.startViewTransition ||= c => c()

const unitDataPromise = fetch("/data/units.json").then(res => res.json())

map.on("load", async () => {
	map.setProjection({type: "globe"})

	const unitData = await unitDataPromise
	processUnit(unitData)
	await addLayers()

	await document.startViewTransition(() => {
		loadingScreen.hidden = true
		mapSection.hidden = false
	})

	await sleep(100)
	
	// Fly to Europe
	map.flyTo({
		center: [10, 50],
		zoom: 3,
		speed: 0.5
	})
})

function calculateUnitLocation(unit) {
	if(unit.units?.length) {
		const latitudes = []
		const longitudes = []
		for(const subunit of unit.units) {
			if(!subunit.location) calculateUnitLocation(subunit)
			if(!subunit.location) continue
			latitudes.push(subunit.location[0])
			longitudes.push(subunit.location[1])
		}
		unit.location = [
			Math.max(...latitudes) / latitudes.length,
			Math.max(...longitudes) / longitudes.length
		]
	}
}

const layers = {}
const loadedImages = []
let geojsonID = 0
function processUnit(unit, parentUnit, depth = 0) {
	// Calculate location from subunits
	if(!unit.location) calculateUnitLocation(unit)

	if(unit.name && unit.location) {
		unit.id ||= unit.name.toLowerCase().replace(/\s+/g, "-")

		if(unit.outline) {
			// Load outline if not already loaded
			if(!map.getSource(`${unit.id}-outline`)) {
				map.addSource(`${unit.id}-outline`, {
					type: "geojson",
					data: unit.outline
				})

				// Default hue
				unit.hue ??= Math.floor(Math.random() * 360)
			
				map.addLayer({
					id: `${unit.id}-outline`,
					type: "fill",
					source: `${unit.id}-outline`,
					paint: {
						"fill-color": `hsl(${unit.hue}, 100%, 50%, 0.05)`,
						"fill-outline-color": `hsl(${unit.hue}, 100%, 50%)`,
					},
				})
			}
		}

		unit.logo ||= "/images/marker.png"
		if(!loadedImages.includes(unit.logo)) {
			loadedImages.push(unit.logo)
			map.loadImage(unit.logo).then(image => {
				map.addImage(unit.logo, image.data)
			})
		}
		
		const layerName = `units-${depth}` + (unit.units?.length ? "" : "-end")

		if(!layers[layerName]) {
			layers[layerName] = {
				// Create geojson definition
				source: {
					type: "geojson",
					data: {
						type: "FeatureCollection",
						features: []
					}
				},
				// Create layer definition
				layer: {
					id: layerName,
					type: "symbol",
					source: layerName,
					minzoom: (depth - 1) * 5,
					maxzoom: unit.units?.length ? depth * 5 : undefined,
					layout: {
						// Icon
						"icon-image": ["get", "logo"],
						"icon-offset": [
							"case",
							["==", ["get", "logo"], "/images/marker.png"],
							["literal", [0, -150]],
							["literal", [0, 0]]
						],
						"icon-size": [
							"interpolate",
							["exponential", 1.5], ["zoom"],
							0, 0.01,
							5, depth == 1 ? 0.25 : 0.1,
							10, Math.min(0.1, 0.25 - (depth * 0.01))
						],
						"icon-allow-overlap": true,

						// Label
						// "text-field": ["get", "name"],
						// "text-font": ["Nunito Sans"],
						// "text-offset": [
						// 	"case",
						// 	["==", ["get", "logo"], "/images/marker.png"],
						// 	["literal", [0, 1]],
						// 	["literal", [0, 2.5]]
						// ],
						// "text-size": 10,
						// "text-allow-overlap": true
					}
				}
			}
		}
		
		// Add unit as a feature to the layer's source
		layers[layerName].source.data.features.push({
			type: "Feature",
			id: geojsonID++,
			geometry: {
				type: "Point",
				coordinates: [unit.location[1], unit.location[0]]
			},
			properties: {
				name: unit.name,
				logo: unit.logo
			}
		})
	}

	if(unit.units) {
		for(const subunit of unit.units) {
			processUnit(subunit, unit, depth + 1)
		}
	}
}


const popup = new maplibregl.Popup({
	closeButton: false,
	closeOnClick: false,
	offset: [0, -30]
});

async function addLayers() {
	for(const layerName in layers) {
		const layer = layers[layerName]
		map.addSource(layerName, layer.source)
		map.addLayer(layer.layer)
	}

	// Add hover effect
	const layerNames = Object.keys(layers)
	let hoveredState = null

	function calculateHover(event) {
		if(!event.features.length) return
		resetHover()
		hoveredState = [event.features[0].source, event.features[0].id]
		map.setFeatureState(
			{
				source: hoveredState[0],
				id: hoveredState[1]
			},
			{hover: true}
		)
		popup.setLngLat(event.features[0].geometry.coordinates)
		popup.setHTML(event.features[0].properties.name)
		popup.addTo(map)
	}

	function resetHover() {
		if(!hoveredState) return
		map.setFeatureState(
			{
				source: hoveredState[0],
				id: hoveredState[1]
			},
			{hover: false}
		)
		hoveredState = null
		popup.remove()
	}

	map.on("mousemove", layerNames, calculateHover)
	map.on("zoom", resetHover)
	map.on("mouseleave", layerNames, resetHover)
}


// let prevZoom = 0
// map.on("render", () => {
// 	const zoom = Number(map.getZoom().toFixed(1))
// 	if(zoom === prevZoom) return
// 	prevZoom = zoom
// 	console.log("Zoom level:", zoom)
// })