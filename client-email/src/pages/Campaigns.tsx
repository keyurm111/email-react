import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { CampaignSetupModal } from '../components/CampaignSetupModal';
import { campaignsApi } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { formatDate, formatNumber, calculatePercentage } from '../utils/helpers';
import type { Campaign } from '../types';
import { Country, State, City } from 'country-state-city';

export const Campaigns = () => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [setupCampaign, setSetupCampaign] = useState<Campaign | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCountry, setFilterCountry] = useState<string>('');
  const [filterState, setFilterState] = useState<string>('');
  const [filterCity, setFilterCity] = useState<string>('');
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadCampaigns();
    const setupId = searchParams.get('setup');
    if (setupId) {
      setTimeout(() => {
        const campaign = campaigns.find(c => c.id === setupId);
        if (campaign) {
          setSetupCampaign(campaign);
        }
      }, 500);
    }
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (campaigns.length > 0) {
      const hasRunning = campaigns.some(c => c.status === 'running');
      if (hasRunning && !refreshIntervalRef.current) {
        console.log('🔄 Starting campaigns auto-refresh (every 5 seconds)');
        refreshIntervalRef.current = setInterval(() => {
          loadCampaigns();
        }, 5000);
      } else if (!hasRunning && refreshIntervalRef.current) {
        console.log('⏸️ Stopping campaigns auto-refresh');
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    }
  }, [campaigns]);

  const loadCampaigns = async () => {
    try {
      setLoading(true);
      const result = await campaignsApi.getCampaigns();
      const campaignsList = (result as any).campaigns || result.data?.campaigns || [];
      if (result.success) {
        setCampaigns(campaignsList);
      } else {
        showToast('Error loading campaigns', 'error');
      }
    } catch (error: any) {
      console.error('Error loading campaigns:', error);
      showToast('Error loading campaigns', 'error');
    } finally {
      setLoading(false);
    }
  };

  const getScheduleInfo = (campaign: Campaign): string => {
    if (campaign.schedule_enabled) {
      return `📅 Daily: ${campaign.schedule_time || '10:00'}`;
    } else if (campaign.scheduled_date) {
      try {
        const date = new Date(campaign.scheduled_date + ' ' + (campaign.schedule_time || '10:00'));
        return `📅 Scheduled: ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
      } catch (e) {
        return '📅 Scheduled';
      }
    } else if (campaign.start_immediate_daily) {
      return `🚀 Immediate + Daily ${campaign.schedule_time || '10:00'}`;
    } else {
      return '🚀 Ready to start';
    }
  };

  const [selectedCountry, setSelectedCountry] = useState<string>('');
  const [selectedState, setSelectedState] = useState<string>('');
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [countrySearch, setCountrySearch] = useState<string>('');
  const [stateSearch, setStateSearch] = useState<string>('');
  const [citySearch, setCitySearch] = useState<string>('');
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [showStateDropdown, setShowStateDropdown] = useState(false);
  const [showCityDropdown, setShowCityDropdown] = useState(false);
  const [showFilterCountryDropdown, setShowFilterCountryDropdown] = useState(false);
  const [showFilterStateDropdown, setShowFilterStateDropdown] = useState(false);
  const [showFilterCityDropdown, setShowFilterCityDropdown] = useState(false);
  const [filterCountrySearch, setFilterCountrySearch] = useState<string>('');
  const [filterStateSearch, setFilterStateSearch] = useState<string>('');
  const [filterCitySearch, setFilterCitySearch] = useState<string>('');

  // Refs for dropdown containers
  const countryDropdownRef = useRef<HTMLDivElement>(null);
  const stateDropdownRef = useRef<HTMLDivElement>(null);
  const cityDropdownRef = useRef<HTMLDivElement>(null);
  const filterCountryDropdownRef = useRef<HTMLDivElement>(null);
  const filterStateDropdownRef = useRef<HTMLDivElement>(null);
  const filterCityDropdownRef = useRef<HTMLDivElement>(null);
  const cityAutoDetectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(event.target as Node)) {
        setShowCountryDropdown(false);
      }
      if (stateDropdownRef.current && !stateDropdownRef.current.contains(event.target as Node)) {
        setShowStateDropdown(false);
      }
      if (cityDropdownRef.current && !cityDropdownRef.current.contains(event.target as Node)) {
        setShowCityDropdown(false);
      }
      if (filterCountryDropdownRef.current && !filterCountryDropdownRef.current.contains(event.target as Node)) {
        setShowFilterCountryDropdown(false);
      }
      if (filterStateDropdownRef.current && !filterStateDropdownRef.current.contains(event.target as Node)) {
        setShowFilterStateDropdown(false);
      }
      if (filterCityDropdownRef.current && !filterCityDropdownRef.current.contains(event.target as Node)) {
        setShowFilterCityDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      // Cleanup timeout on unmount
      if (cityAutoDetectTimeoutRef.current) {
        clearTimeout(cityAutoDetectTimeoutRef.current);
      }
    };
  }, []);

  // Get countries, states, and cities for dropdowns
  const countries = Country.getAllCountries();
  const states = selectedCountry ? State.getStatesOfCountry(selectedCountry) : [];
  const cities = selectedState && selectedCountry ? City.getCitiesOfState(selectedCountry, selectedState) : [];

  // Filter countries based on search (must start with search term)
  const filteredCountries = countrySearch.trim()
    ? countries.filter((country) =>
        country.name.toLowerCase().startsWith(countrySearch.toLowerCase())
      )
    : [];

  // Filter states based on search (must start with search term)
  const filteredStates = stateSearch.trim()
    ? states.filter((state) =>
        state.name.toLowerCase().startsWith(stateSearch.toLowerCase())
      )
    : [];

  // Filter cities based on search (must start with search term)
  const filteredCities = citySearch.trim()
    ? cities.filter((city) =>
        city.name.toLowerCase().startsWith(citySearch.toLowerCase())
      )
    : [];

  // Auto-detect country and state when city is entered directly
  const handleCityAutoDetect = (cityName: string) => {
    if (!cityName.trim() || selectedState) return; // Skip if state already selected
    
    // Try to find the city and auto-detect state and country
    // Limit search to first 30 countries for performance
    for (const country of countries.slice(0, 30)) {
      const countryStates = State.getStatesOfCountry(country.isoCode);
      for (const state of countryStates.slice(0, 20)) { // Limit states per country
        const stateCities = City.getCitiesOfState(country.isoCode, state.isoCode);
        const foundCity = stateCities.find(c => 
          c.name.toLowerCase() === cityName.toLowerCase().trim()
        );
        if (foundCity) {
          setSelectedCountry(country.isoCode);
          setSelectedState(state.isoCode);
          setSelectedCity(foundCity.name);
          setCountrySearch(country.name);
          setStateSearch(state.name);
          setCitySearch(foundCity.name);
          return true; // Found and set
        }
      }
    }
    return false; // Not found
  };

  const handleCreateCampaign = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const name = (formData.get('name') as string).trim();
    const description = (formData.get('description') as string).trim();
    
    // Get full names for country, state, and city (not just codes)
    let countryName = '';
    let stateName = '';
    const cityName = selectedCity || '';
    
    if (selectedCountry) {
      try {
        const country = Country.getCountryByCode(selectedCountry);
        countryName = country?.name || selectedCountry;
      } catch {
        countryName = selectedCountry;
      }
    }
    
    if (selectedState && selectedCountry) {
      try {
        const state = State.getStateByCodeAndCountry(selectedState, selectedCountry);
        stateName = state?.name || selectedState;
      } catch {
        stateName = selectedState;
      }
    }

    if (!name) {
      showToast('Campaign name required', 'error');
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    const originalText = submitBtn?.innerHTML || '';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    }

    try {
      const result = await campaignsApi.createCampaign(name, description, countryName, stateName, cityName);
      const campaign = (result as any).campaign || result.data?.campaign;

      if (result.success && campaign) {
        showToast('Campaign created successfully!', 'success');
        if (form && typeof form.reset === 'function') {
          form.reset();
        }
        // Reset location fields
        setSelectedCountry('');
        setSelectedState('');
        setSelectedCity('');
        setCountrySearch('');
        setStateSearch('');
        setCitySearch('');
        setShowCountryDropdown(false);
        setShowStateDropdown(false);
        setShowCityDropdown(false);
        await loadCampaigns();

        // Optionally open setup modal
        if (campaign) {
          setTimeout(() => setSetupCampaign(campaign), 500);
        }
      } else {
        showToast(result.message || 'Error creating campaign', 'error');
      }
    } catch (error: any) {
      console.error('Error creating campaign:', error);
      showToast('Error creating campaign: ' + error.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText || '<i class="fas fa-plus"></i> Create Campaign';
      }
    }
  };

  const handleSetup = (campaign: Campaign) => {
    setSetupCampaign(campaign);
  };

  const handleStartCampaign = async (campaignId: string) => {
    const campaign = campaigns.find(c => c.id === campaignId);
    if (!campaign) return;

    // Validation checks (same as HTML/JS version)
    if (!campaign.selected_senders || campaign.selected_senders.length === 0) {
      showToast('❌ No senders selected! Please setup the campaign first.', 'error');
      return;
    }

    if (!campaign.leads_data && !campaign.leads_file) {
      showToast('❌ No leads uploaded! Please setup the campaign first.', 'error');
      return;
    }

    if (!campaign.template_data && !campaign.template_file) {
      showToast('❌ No template uploaded! Please setup the campaign first.', 'error');
      return;
    }

    // All validations passed - start the campaign
    try {
      const result = await campaignsApi.startCampaign(campaignId);

      if (result.success) {
        showToast('✅ Campaign started successfully!', 'success');
        
        // Redirect to active campaign page
        setTimeout(() => {
          navigate(`/active-campaign?id=${encodeURIComponent(campaignId)}`);
        }, 500);
      } else {
        showToast(result.message || 'Error starting campaign', 'error');
      }
    } catch (error: any) {
      console.error('Error starting campaign:', error);
      showToast('Error starting campaign: ' + error.message, 'error');
    }
  };

  const handleDelete = async (campaignId: string) => {
    const campaign = campaigns.find(c => c.id === campaignId);
    if (campaign && confirm(`Are you sure you want to delete campaign: ${campaign.name}?`)) {
      try {
        const result = await campaignsApi.deleteCampaign(campaignId);
        if (result.success) {
          showToast('Campaign deleted successfully', 'success');
          await loadCampaigns();
        } else {
          showToast('Error deleting campaign', 'error');
        }
      } catch (error: any) {
        showToast('Error deleting campaign: ' + error.message, 'error');
      }
    }
  };

  // Unique location values used in campaigns (names)
  const usedCountryNames = Array.from(
    new Set(
      campaigns
        .map((c) => (c.country || '').trim())
        .filter((v) => v.length > 0)
    )
  );

  const usedStateNamesByCountry = (countryName: string) =>
    new Set(
      campaigns
        .filter((c) => (c.country || '').trim() === countryName)
        .map((c) => (c.state || '').trim())
        .filter((v) => v.length > 0)
    );

  // Unique (country, state, city) combinations used in campaigns
  const usedLocationTriples = Array.from(
    new Map(
      campaigns
        .map((c) => {
          const country = (c.country || '').trim();
          const state = (c.state || '').trim();
          const city = (c.city || '').trim();
          if (!country || !state || !city) return null;
          const key = `${country}||${state}||${city}`;
          return [key, { country, state, city }] as const;
        })
        .filter(
          (entry): entry is [string, { country: string; state: string; city: string }] =>
            entry !== null
        )
    ).values()
  );

  // Filter dropdown options using Country/State/City library,
  // but only for locations that actually exist on campaigns
  const allCountriesLib = Country.getAllCountries();
  const filterCountries = allCountriesLib.filter((country) =>
    usedCountryNames.includes(country.name)
  );

  const filteredFilterCountries = filterCountrySearch.trim()
    ? filterCountries.filter((country) =>
        country.name.toLowerCase().startsWith(filterCountrySearch.toLowerCase())
      )
    : filterCountries;

  let filterStates: { name: string; isoCode: string }[] = [];

  if (filterCountry) {
    const countryObj = allCountriesLib.find((c) => c.name === filterCountry);
    if (countryObj) {
      const usedStates = usedStateNamesByCountry(filterCountry);
      filterStates = State.getStatesOfCountry(countryObj.isoCode).filter((state) =>
        usedStates.has(state.name)
      );
    }
  }

  const filteredFilterStates = filterStateSearch.trim()
    ? filterStates.filter((state) =>
        state.name.toLowerCase().startsWith(filterStateSearch.toLowerCase())
      )
    : filterStates;

  let filterCities: { name: string; country: string; state: string }[] = [];

  if (filterCountry && filterState) {
    // Cities for selected country + state, based on campaigns
    filterCities = usedLocationTriples
      .filter(
        (loc) => loc.country === filterCountry && loc.state === filterState
      )
      .map((loc) => ({
        name: loc.city,
        country: loc.country,
        state: loc.state,
      }));
  } else {
    // Global city list (optionally scoped by selected country)
    filterCities = usedLocationTriples
      .filter((loc) => {
        if (filterCountry && loc.country !== filterCountry) return false;
        return true;
      })
      .map((loc) => ({
        name: loc.city,
        country: loc.country,
        state: loc.state,
      }));
  }

  const filteredFilterCities = filterCitySearch.trim()
    ? filterCities.filter((city) =>
        city.name.toLowerCase().startsWith(filterCitySearch.toLowerCase())
      )
    : filterCities;

  // Filter campaigns based on search query + location filters
  const filteredCampaigns = campaigns.filter((campaign) => {
    // Location filters
    if (filterCountry && campaign.country !== filterCountry) return false;
    if (filterState && campaign.state !== filterState) return false;
    if (filterCity && campaign.city !== filterCity) return false;

    // Text search
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      campaign.name.toLowerCase().includes(query) ||
      (campaign.description || '').toLowerCase().includes(query) ||
      campaign.status.toLowerCase().includes(query) ||
      (campaign.country || '').toLowerCase().includes(query) ||
      (campaign.state || '').toLowerCase().includes(query) ||
      (campaign.city || '').toLowerCase().includes(query)
    );
  });


  return (
    <Layout>
      {/* Create Campaign */}
      <section className="bg-white rounded-xl shadow-md mb-4 sm:mb-6">
        <div className={`border-b ${createFormOpen ? 'border-gray-200' : ''}`}>
          <div
            className="p-4 sm:p-6 cursor-pointer hover:bg-gray-50 transition-colors flex items-center justify-between select-none"
            onClick={() => setCreateFormOpen(!createFormOpen)}
          >
            <h3 className="font-semibold text-gray-800 flex items-center gap-2 text-base sm:text-lg">
              <i className="fas fa-plus-circle"></i> 
              <span className="hidden sm:inline">Create New Campaign</span>
              <span className="sm:hidden">Create Campaign</span>
            </h3>
            <i className={`fas fa-chevron-down transition-transform duration-300 text-sm ${createFormOpen ? 'transform rotate-180' : ''}`}></i>
          </div>
        </div>
        {createFormOpen && (
          <div className="p-4 sm:p-6">
            <form onSubmit={handleCreateCampaign} className="space-y-4 sm:space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Campaign Name *
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                  placeholder="e.g., Q4 Newsletter"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  name="description"
                  rows={3}
                  className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                  placeholder="Describe your campaign..."
                ></textarea>
              </div>
              
              {/* Location Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Country - Searchable */}
                <div className="relative" ref={countryDropdownRef}>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Country
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={countrySearch}
                      onChange={(e) => {
                        setCountrySearch(e.target.value);
                        setShowCountryDropdown(true);
                        if (!e.target.value) {
                          setSelectedCountry('');
                          setSelectedState('');
                          setSelectedCity('');
                          setStateSearch('');
                          setCitySearch('');
                        }
                      }}
                      onFocus={() => setShowCountryDropdown(true)}
                      placeholder="Type to search country..."
                      className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                    />
                    {countrySearch && (
                      <button
                        type="button"
                        onClick={() => {
                          setCountrySearch('');
                          setSelectedCountry('');
                          setSelectedState('');
                          setSelectedCity('');
                          setStateSearch('');
                          setCitySearch('');
                          setShowCountryDropdown(false);
                        }}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        <i className="fas fa-times text-sm"></i>
                      </button>
                    )}
                    {showCountryDropdown && countrySearch.trim() && filteredCountries.length > 0 && (
                      <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {filteredCountries.slice(0, 10).map((country) => (
                          <button
                            key={country.isoCode}
                            type="button"
                            onClick={() => {
                              setSelectedCountry(country.isoCode);
                              setCountrySearch(country.name);
                              setSelectedState('');
                              setSelectedCity('');
                              setStateSearch('');
                              setCitySearch('');
                              setShowCountryDropdown(false);
                            }}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 transition-colors"
                          >
                            {country.name}
                          </button>
                        ))}
                        {filteredCountries.length > 10 && (
                          <div className="px-3 py-2 text-xs text-gray-500 text-center">
                            Showing first 10 of {filteredCountries.length} results
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* State - Searchable */}
                <div className="relative" ref={stateDropdownRef}>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    State
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={stateSearch}
                      onChange={(e) => {
                        setStateSearch(e.target.value);
                        setShowStateDropdown(true);
                        if (!e.target.value) {
                          setSelectedState('');
                          setSelectedCity('');
                          setCitySearch('');
                        }
                      }}
                      onFocus={() => selectedCountry && setShowStateDropdown(true)}
                      placeholder={selectedCountry ? "Type to search state..." : "Select country first"}
                      disabled={!selectedCountry}
                      className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea] disabled:bg-gray-100 disabled:cursor-not-allowed"
                    />
                    {stateSearch && (
                      <button
                        type="button"
                        onClick={() => {
                          setStateSearch('');
                          setSelectedState('');
                          setSelectedCity('');
                          setCitySearch('');
                          setShowStateDropdown(false);
                        }}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        <i className="fas fa-times text-sm"></i>
                      </button>
                    )}
                    {showStateDropdown && selectedCountry && stateSearch.trim() && filteredStates.length > 0 && (
                      <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {filteredStates.slice(0, 10).map((state) => (
                          <button
                            key={state.isoCode}
                            type="button"
                            onClick={() => {
                              setSelectedState(state.isoCode);
                              setStateSearch(state.name);
                              setSelectedCity('');
                              setCitySearch('');
                              setShowStateDropdown(false);
                            }}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 transition-colors"
                          >
                            {state.name}
                          </button>
                        ))}
                        {filteredStates.length > 10 && (
                          <div className="px-3 py-2 text-xs text-gray-500 text-center">
                            Showing first 10 of {filteredStates.length} results
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* City - Searchable with Auto-detection */}
                <div className="relative" ref={cityDropdownRef}>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    City
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={citySearch}
                      onChange={(e) => {
                        const cityValue = e.target.value;
                        setCitySearch(cityValue);
                        setShowCityDropdown(true);
                        
                        // Clear previous timeout
                        if (cityAutoDetectTimeoutRef.current) {
                          clearTimeout(cityAutoDetectTimeoutRef.current);
                        }
                        
                        // Auto-detect country and state if city is entered directly (only if no state selected)
                        if (cityValue.trim() && !selectedState) {
                          // Use debounce: only auto-detect after user stops typing for 800ms
                          cityAutoDetectTimeoutRef.current = setTimeout(() => {
                            if (cityValue.trim() && !selectedState) {
                              handleCityAutoDetect(cityValue);
                            }
                          }, 800); // Wait 800ms after user stops typing
                        } else if (!cityValue) {
                          setSelectedCity('');
                        }
                      }}
                      onFocus={() => {
                        setShowCityDropdown(true);
                      }}
                      onKeyDown={(e) => {
                        // Auto-detect on Enter key if city is typed and no state selected
                        if (e.key === 'Enter' && citySearch.trim() && !selectedState) {
                          e.preventDefault();
                          handleCityAutoDetect(citySearch);
                          setShowCityDropdown(false);
                        }
                      }}
                      placeholder={selectedState ? "Type to search city..." : "Type city name (auto-detects location)"}
                      className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                    />
                    {citySearch && (
                      <button
                        type="button"
                        onClick={() => {
                          setCitySearch('');
                          setSelectedCity('');
                          setShowCityDropdown(false);
                        }}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        <i className="fas fa-times text-sm"></i>
                      </button>
                    )}
                    {showCityDropdown && citySearch && (
                      <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {(() => {
                          // If state is selected, show cities from that state
                          if (selectedState && selectedCountry) {
                            const matchingCities = filteredCities.slice(0, 10);
                            if (matchingCities.length > 0) {
                              return (
                                <>
                                  {matchingCities.map((city, index) => (
                                    <button
                                      key={`${city.name}-${index}`}
                                      type="button"
                                      onClick={() => {
                                        setSelectedCity(city.name);
                                        setCitySearch(city.name);
                                        setShowCityDropdown(false);
                                      }}
                                      className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 transition-colors"
                                    >
                                      {city.name}
                                    </button>
                                  ))}
                                  {filteredCities.length > 10 && (
                                    <div className="px-3 py-2 text-xs text-gray-500 text-center">
                                      Showing first 10 of {filteredCities.length} results
                                    </div>
                                  )}
                                </>
                              );
                            }
                          }
                          
                          // If no state selected, search all cities globally (must start with search term)
                          const allCities: Array<{name: string, country: string, state: string}> = [];
                          for (const country of countries.slice(0, 50)) { // Limit to first 50 countries for performance
                            const countryStates = State.getStatesOfCountry(country.isoCode);
                            for (const state of countryStates.slice(0, 10)) { // Limit states per country
                              const stateCities = City.getCitiesOfState(country.isoCode, state.isoCode);
                              for (const city of stateCities) {
                                if (city.name.toLowerCase().startsWith(citySearch.toLowerCase())) {
                                  allCities.push({
                                    name: city.name,
                                    country: country.name,
                                    state: state.name
                                  });
                                  if (allCities.length >= 10) break;
                                }
                              }
                              if (allCities.length >= 10) break;
                            }
                            if (allCities.length >= 10) break;
                          }
                          
                          if (allCities.length > 0) {
                            return (
                              <>
                                {allCities.map((city, index) => (
                                  <button
                                    key={`${city.name}-${index}`}
                                    type="button"
                                    onClick={() => {
                                      // Find and set the country and state for this city
                                      for (const country of countries) {
                                        const countryStates = State.getStatesOfCountry(country.isoCode);
                                        for (const state of countryStates) {
                                          const stateCities = City.getCitiesOfState(country.isoCode, state.isoCode);
                                          const foundCity = stateCities.find(c => c.name === city.name);
                                          if (foundCity) {
                                            setSelectedCountry(country.isoCode);
                                            setSelectedState(state.isoCode);
                                            setSelectedCity(city.name);
                                            setCountrySearch(country.name);
                                            setStateSearch(state.name);
                                            setCitySearch(city.name);
                                            setShowCityDropdown(false);
                                            return;
                                          }
                                        }
                                      }
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 transition-colors"
                                  >
                                    <div className="font-medium">{city.name}</div>
                                    <div className="text-xs text-gray-500">{city.state}, {city.country}</div>
                                  </button>
                                ))}
                              </>
                            );
                          }
                          
                          return (
                            <div className="px-3 py-2 text-xs text-gray-500 text-center">
                              No cities found. You can type the city name directly.
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="w-full sm:w-auto px-4 sm:px-6 py-2 text-sm sm:text-base bg-gradient-to-r from-[#667eea] to-[#764ba2] text-white rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
              >
                <i className="fas fa-plus"></i>
                Create Campaign
              </button>
            </form>
          </div>
        )}
      </section>

      {/* Campaign List */}
      <section className="bg-white rounded-xl shadow-md p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:gap-4 mb-4 sm:mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <h2 className="text-lg sm:text-xl font-semibold text-gray-800 flex items-center gap-2">
            <i className="fas fa-list"></i> Your Campaigns
          </h2>
          {campaigns.length > 0 && (
            <div className="relative flex-1 sm:max-w-md w-full">
              <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 text-sm"></i>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search campaigns..."
                className="w-full pl-9 sm:pl-10 pr-8 sm:pr-10 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 sm:right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
                >
                  <i className="fas fa-times"></i>
                </button>
              )}
              </div>
            )}
          </div>

          {/* Location Filters */}
          {campaigns.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Country Filter */}
              <div className="relative" ref={filterCountryDropdownRef}>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
                  Country
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={filterCountrySearch}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFilterCountrySearch(value);
                      setShowFilterCountryDropdown(true);
                      if (!value) {
                        setFilterCountry('');
                        setFilterState('');
                        setFilterCity('');
                        setFilterStateSearch('');
                        setFilterCitySearch('');
                      }
                    }}
                    onFocus={() => {
                      if (filterCountries.length > 0) {
                        setShowFilterCountryDropdown(true);
                      }
                    }}
                    placeholder="Type to search country..."
                    className="w-full px-3 sm:px-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
                  />
                  {filterCountrySearch && (
                    <button
                      type="button"
                      onClick={() => {
                        setFilterCountrySearch('');
                        setFilterCountry('');
                        setFilterState('');
                        setFilterCity('');
                        setFilterStateSearch('');
                        setFilterCitySearch('');
                        setShowFilterCountryDropdown(false);
                      }}
                      className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <i className="fas fa-times text-sm"></i>
                    </button>
                  )}
                </div>
                {showFilterCountryDropdown && (
                  <div className="absolute z-40 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {filteredFilterCountries.map((country) => (
                      <button
                        key={country.isoCode}
                        type="button"
                        onClick={() => {
                          setFilterCountry(country.name);
                          setFilterCountrySearch(country.name);
                          setFilterState('');
                          setFilterCity('');
                          setFilterStateSearch('');
                          setFilterCitySearch('');
                          setShowFilterCountryDropdown(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100"
                      >
                        {country.name}
                      </button>
                    ))}
                    {filteredFilterCountries.length === 0 && (
                      <div className="px-3 py-2 text-xs text-gray-500 text-center">
                        No matching countries used in campaigns
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* State Filter */}
              <div className="relative" ref={filterStateDropdownRef}>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
                  State
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={filterStateSearch}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFilterStateSearch(value);
                      if (value) {
                        setShowFilterStateDropdown(true);
                      } else {
                        setFilterState('');
                        setFilterCity('');
                        setFilterCitySearch('');
                      }
                    }}
                    onFocus={() => {
                      if (filterStates.length > 0) {
                        setShowFilterStateDropdown(true);
                      }
                    }}
                    placeholder={
                      filterCountry ? 'Type to search state used in campaigns...' : 'Select country first'
                    }
                    disabled={!filterCountry || filterStates.length === 0}
                    className="w-full px-3 sm:px-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea] disabled:bg-gray-100 disabled:cursor-not-allowed"
                  />
                  {filterStateSearch && (
                    <button
                      type="button"
                      onClick={() => {
                        setFilterStateSearch('');
                        setFilterState('');
                        setFilterCity('');
                        setFilterCitySearch('');
                        setShowFilterStateDropdown(false);
                      }}
                      className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <i className="fas fa-times text-sm"></i>
                    </button>
                  )}
                </div>
                {showFilterStateDropdown && filteredFilterStates.length > 0 && (
                  <div className="absolute z-40 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {filteredFilterStates.map((state) => (
                      <button
                        key={state.isoCode}
                        type="button"
                        onClick={() => {
                          setFilterState(state.name);
                          setFilterStateSearch(state.name);
                          setFilterCity('');
                          setFilterCitySearch('');
                          setShowFilterStateDropdown(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100"
                      >
                        {state.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* City Filter */}
              <div className="relative" ref={filterCityDropdownRef}>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
                  City
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={filterCitySearch}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFilterCitySearch(value);
                      if (value) {
                        setShowFilterCityDropdown(true);
                      } else {
                        setFilterCity('');
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && filterCitySearch.trim()) {
                        e.preventDefault();
                        const searchLower = filterCitySearch.toLowerCase().trim();
                        let match =
                          filteredFilterCities.find(
                            (city) =>
                              city.name.toLowerCase() === searchLower
                          ) || filteredFilterCities[0];
                        if (match) {
                          setFilterCountry(match.country);
                          setFilterCountrySearch(match.country);
                          setFilterState(match.state);
                          setFilterStateSearch(match.state);
                          setFilterCity(match.name);
                          setFilterCitySearch(match.name);
                          setShowFilterCityDropdown(false);
                        }
                      }
                    }}
                    onFocus={() => {
                      if (filterCities.length > 0) {
                        setShowFilterCityDropdown(true);
                      }
                    }}
                    placeholder={
                      usedLocationTriples.length === 0
                        ? 'No cities used yet'
                        : 'Type city name (auto-detects country & state)'
                    }
                    disabled={filterCities.length === 0}
                    className="w-full px-3 sm:px-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea] disabled:bg-gray-100 disabled:cursor-not-allowed"
                  />
                  {filterCitySearch && (
                    <button
                      type="button"
                      onClick={() => {
                        setFilterCitySearch('');
                        setFilterCity('');
                        setShowFilterCityDropdown(false);
                      }}
                      className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <i className="fas fa-times text-sm"></i>
                    </button>
                  )}
                </div>
                {showFilterCityDropdown && filteredFilterCities.length > 0 && (
                  <div className="absolute z-40 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {filteredFilterCities.map((city) => (
                      <button
                        key={city.name}
                        type="button"
                        onClick={() => {
                          setFilterCountry(city.country);
                          setFilterCountrySearch(city.country);
                          setFilterState(city.state);
                          setFilterStateSearch(city.state);
                          setFilterCity(city.name);
                          setFilterCitySearch(city.name);
                          setShowFilterCityDropdown(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100"
                      >
                        <div className="font-medium">{city.name}</div>
                        <div className="text-xs text-gray-500">
                          {city.state}, {city.country}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        {loading ? (
          <div className="text-center py-6 sm:py-8">
            <i className="fas fa-spinner fa-spin text-xl sm:text-2xl text-gray-400"></i>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-6 sm:py-8 text-gray-500">
            <i className="fas fa-inbox text-3xl sm:text-4xl mb-2"></i>
            <p className="text-sm sm:text-base">No campaigns yet. Create your first campaign above!</p>
          </div>
        ) : filteredCampaigns.length === 0 ? (
          <div className="text-center py-6 sm:py-8 text-gray-500">
            <i className="fas fa-search text-3xl sm:text-4xl mb-2"></i>
            <p className="text-sm sm:text-base">No campaigns found matching "{searchQuery}"</p>
            <button
              onClick={() => setSearchQuery('')}
              className="mt-2 text-sm sm:text-base text-[#667eea] hover:underline"
            >
              Clear search
            </button>
          </div>
        ) : (
          <>
            {searchQuery && (
              <div className="mb-3 sm:mb-4 text-xs sm:text-sm text-gray-600">
                Found <strong>{filteredCampaigns.length}</strong> {filteredCampaigns.length === 1 ? 'campaign' : 'campaigns'} matching "{searchQuery}"
              </div>
            )}
            <div className="space-y-3 sm:space-y-4">
              {filteredCampaigns.map((campaign) => {
              const progress = campaign.stats?.total_leads
                ? calculatePercentage(campaign.stats.total_sent || 0, campaign.stats.total_leads)
                : '0';

              return (
                <div
                  key={campaign.id}
                  className="bg-white rounded-xl shadow-sm p-4 sm:p-6 border-l-4 border-[#667eea] hover:shadow-md transition-shadow"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-3 sm:mb-4 gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
                        <h3 className="text-base sm:text-lg font-semibold text-gray-800 truncate">{campaign.name}</h3>
                        <span
                          className={`px-2 sm:px-3 py-1 rounded text-xs font-semibold flex-shrink-0 ${
                            campaign.status === 'running'
                              ? 'bg-green-100 text-green-800'
                              : campaign.status === 'completed'
                              ? 'bg-blue-100 text-blue-800'
                              : campaign.status === 'paused'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {campaign.status}
                        </span>
                      </div>
                      <p className="text-sm sm:text-base text-gray-600 mb-3 sm:mb-4 italic line-clamp-2">{campaign.description || 'No description'}</p>
                      {(campaign.country || campaign.state || campaign.city) && (
                        <div className="flex flex-wrap gap-2 sm:gap-3 mb-2 sm:mb-3">
                          {campaign.country && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs sm:text-sm">
                              <i className="fas fa-globe text-blue-600"></i>
                              {campaign.country}
                            </span>
                          )}
                          {campaign.state && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded text-xs sm:text-sm">
                              <i className="fas fa-map-marker-alt text-green-600"></i>
                              {campaign.state}
                            </span>
                          )}
                          {campaign.city && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-50 text-purple-700 rounded text-xs sm:text-sm">
                              <i className="fas fa-city text-purple-600"></i>
                              {campaign.city}
                            </span>
                          )}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2 sm:gap-4 text-xs sm:text-sm text-gray-600 mb-3">
                        <span className="flex items-center gap-1 sm:gap-2">
                          <i className="fas fa-calendar text-[#667eea]"></i>
                          {formatDate(campaign.created_at)}
                        </span>
                        {campaign.selected_senders && campaign.selected_senders.length > 0 && (
                          <span className="flex items-center gap-1 sm:gap-2">
                            <i className="fas fa-paper-plane text-[#667eea]"></i>
                            {campaign.selected_senders.length} senders
                          </span>
                        )}
                        {campaign.stats?.total_leads && (
                          <span className="flex items-center gap-1 sm:gap-2">
                            <i className="fas fa-users text-[#667eea]"></i>
                            {formatNumber(campaign.stats.total_leads)} leads
                          </span>
                        )}
                        <span className="flex items-center gap-1 sm:gap-2">
                          <i className="fas fa-clock text-[#667eea]"></i>
                          <span className="hidden sm:inline">{getScheduleInfo(campaign)}</span>
                          <span className="sm:hidden">Scheduled</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {campaign.stats?.total_leads && (
                    <div className="mb-3 sm:mb-4">
                      <div className="flex items-center justify-between text-xs sm:text-sm text-gray-600 mb-2">
                        <span>Progress</span>
                        <span>
                          {campaign.stats.total_sent || 0} / {campaign.stats.total_leads} ({progress}%)
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-[#667eea] h-2 rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        ></div>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => handleSetup(campaign)}
                      className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors text-xs sm:text-sm flex items-center justify-center gap-1 sm:gap-2"
                    >
                      <i className="fas fa-cog"></i> <span className="hidden sm:inline">Setup</span>
                    </button>
                    {campaign.status === 'running' ? (
                      <button
                        onClick={() => navigate(`/active-campaign?id=${campaign.id}`)}
                        className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-blue-500 text-white rounded-lg hover:opacity-90 transition-opacity text-xs sm:text-sm flex items-center justify-center gap-1 sm:gap-2"
                      >
                        <i className="fas fa-eye"></i> <span className="hidden sm:inline">View</span>
                      </button>
                    ) : campaign.status === 'completed' ? (
                      <button
                        onClick={() => navigate(`/active-campaign?id=${campaign.id}`)}
                        className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-blue-500 text-white rounded-lg hover:opacity-90 transition-opacity text-xs sm:text-sm flex items-center justify-center gap-1 sm:gap-2"
                      >
                        <i className="fas fa-eye"></i> <span className="hidden sm:inline">View</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStartCampaign(campaign.id)}
                        className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-green-500 text-white rounded-lg hover:opacity-90 transition-opacity text-xs sm:text-sm flex items-center justify-center gap-1 sm:gap-2"
                      >
                        <i className="fas fa-play"></i> <span className="hidden sm:inline">Start</span>
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(campaign.id)}
                      className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-red-500 text-white rounded-lg hover:opacity-90 transition-opacity text-xs sm:text-sm flex items-center justify-center gap-1 sm:gap-2"
                    >
                      <i className="fas fa-trash"></i> <span className="hidden sm:inline">Delete</span>
                    </button>
                  </div>
                </div>
              );
            })}
            </div>
          </>
        )}
      </section>

      {/* Setup Modal */}
      {setupCampaign && (
        <CampaignSetupModal
          campaign={setupCampaign}
          onClose={() => setSetupCampaign(null)}
          onUpdate={loadCampaigns}
          showToast={showToast}
        />
      )}
    </Layout>
  );
};
