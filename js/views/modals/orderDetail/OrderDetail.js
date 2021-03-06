import _ from 'underscore';
import $ from 'jquery';
import app from '../../../app';
import { capitalize } from '../../../utils/string';
import { getSocket } from '../../../utils/serverConnect';
import {
  resolvingDispute,
  events as orderEvents,
} from '../../../utils/order';
import { getCachedProfiles } from '../../../models/profile/Profile';
import loadTemplate from '../../../utils/loadTemplate';
import Case from '../../../models/order/Case';
import OrderFulfillment from '../../../models/order/orderFulfillment/OrderFulfillment';
import OrderDispute from '../../../models/order/OrderDispute';
import ResolveDisputeMd from '../../../models/order/ResolveDispute';
import BaseModal from '../BaseModal';
import ProfileBox from './ProfileBox';
import Summary from './summaryTab/Summary';
import Discussion from './Discussion';
import Contract from './Contract';
import FulfillOrder from './FulfillOrder';
import DisputeOrder from './DisputeOrder';
import ResolveDispute from './ResolveDispute';
import ActionBar from './ActionBar.js';

export default class extends BaseModal {
  constructor(options = {}) {
    const opts = {
      initialState: {
        isFetching: false,
        fetchFailed: false,
        fetchError: '',
      },
      initialTab: 'summary',
      ...options,
    };

    super(opts);
    this._tab = opts.initialTab;
    this.options = opts;
    this.tabViewCache = {};

    if (!this.model) {
      throw new Error('Please provide an Order model.');
    }

    this._state = {
      ...opts.initialState || {},
    };

    this.listenTo(this.model, 'request', this.onOrderRequest);
    this.listenToOnce(this.model, 'sync', this.onFirstOrderSync);
    this.listenTo(this.model, 'change:unreadChatMessages',
      () => this.setUnreadChatMessagesBadge());

    this.listenTo(orderEvents, 'fulfillOrderComplete', () => {
      if (this.activeTab === 'fulfillOrder') this.selectTab('summary');
    });

    this.listenTo(this.model, 'change:state', () => {
      if (this.actionBar) {
        this.actionBar.setState(this.actionBarButtonState);
      }
    });

    this.listenTo(orderEvents, 'openDisputeComplete', () => {
      if (this.activeTab === 'disputeOrder') this.selectTab('summary');
    });

    this.listenTo(orderEvents, 'resolveDisputeComplete', () => {
      if (this.activeTab === 'resolveDispute') this.selectTab('summary');
    });

    const socket = getSocket();

    if (socket) {
      this.listenTo(socket, 'message', this.onSocketMessage);
    }

    this.model.fetch();
  }

  className() {
    return `${super.className()} modalScrollPage tabbedModal orderDetail`;
  }

  events() {
    return {
      'click .js-toggleSendReceive': 'onClickToggleSendReceive',
      'click .js-retryFetch': 'onClickRetryFetch',
      'click .js-returnBox': 'onClickReturnBox',
      'click .js-tab': 'onTabClick',
      ...super.events(),
    };
  }

  onOrderRequest(md, xhr) {
    this.setState({
      isFetching: true,
      fetchError: '',
      fetchFailed: false,
    });

    xhr.done(() => {
      this.setState({
        isFetching: false,
        fetchFailed: false,
      });
    }).fail((jqXhr) => {
      if (jqXhr.statusText === 'abort') return;

      let fetchError = '';

      if (jqXhr.responseJSON && jqXhr.responseJSON.reason) {
        fetchError = jqXhr.responseJSON.reason;
      }

      this.setState({
        isFetching: false,
        fetchFailed: true,
        fetchError,
      });
    });
  }

  onFirstOrderSync() {
    this.stopListening(this.model, null, this.onOrderRequest);

    if (this.type === 'case') {
      this.featuredProfileFetch =
        this.model.get('buyerOpened') ? this.getBuyerProfile() : this.getVendorProfile();
    } else if (this.type === 'sale') {
      this.featuredProfileFetch = this.getBuyerProfile();
    } else {
      this.featuredProfileFetch = this.getVendorProfile();
    }

    this.featuredProfileFetch.done(profile => {
      this.featuredProfileMd = profile;
      this.featuredProfile.setModel(this.featuredProfileMd);
      this.featuredProfile.setState({
        isFetching: false,
      });
    });
  }

  onClickRetryFetch() {
    this.model.fetch();
  }

  onClickReturnBox() {
    this.close();
  }

  onTabClick(e) {
    const targ = $(e.target).closest('.js-tab');
    this.selectTab(targ.attr('data-tab'));
  }

  onSocketMessage(e) {
    if (e.jsonData.message &&
       e.jsonData.message.subject === this.model.id &&
       this.activeTab !== 'discussion') {
      const count = this.model.get('unreadChatMessages');
      this.model.set('unreadChatMessages', count + 1);
    }
  }

  get type() {
    return this.model instanceof Case ? 'case' : this.model.type;
  }

  get participantIds() {
    if (!this._participantIds) {
      let contract = this.model.get('contract');

      if (this.type === 'case') {
        contract = this.model.get('buyerOpened') ?
          this.model.get('buyerContract') :
          this.model.get('vendorContract');
      }

      const contractJSON = contract.toJSON();

      this._participantIds = {
        buyer: contractJSON.buyerOrder.buyerID.peerID,
        vendor: contractJSON.vendorListings[0].vendorID.peerID,
        moderator: contractJSON.buyerOrder.payment.moderator,
      };
    }

    return this._participantIds;
  }

  get buyerId() {
    return this.participantIds.buyer;
  }

  get vendorId() {
    return this.participantIds.vendor;
  }

  get moderatorId() {
    return this.participantIds.moderator;
  }

  _getParticipantProfile(participantType) {
    const idKey = `${participantType}Id`;
    const profileKey = `_${participantType}Profile`;

    if (!this[profileKey]) {
      if (this[idKey] === app.profile.id) {
        const deferred = $.Deferred();
        deferred.resolve(app.profile);
        this[profileKey] = deferred.promise();
      } else {
        this[profileKey] = getCachedProfiles([this[idKey]])[0];
      }
    }

    return this[profileKey];
  }

  /**
   * Returns a promise that resolves with the buyer's Profile model.
   */
  getBuyerProfile() {
    return this._getParticipantProfile('buyer');
  }

  /**
   * Returns a promise that resolves with the vendor's Profile model.
   */
  getVendorProfile() {
    return this._getParticipantProfile('vendor');
  }

  /**
   * Returns a promise that resolves with the moderator's Profile model.
   */
  getModeratorProfile() {
    return this._getParticipantProfile('moderator');
  }

  get activeTab() {
    return this._tab;
  }

  getState() {
    return this._state;
  }

  setState(state, replace = false) {
    let newState;

    if (replace) {
      this._state = {};
    } else {
      newState = _.extend({}, this._state, state);
    }

    if (!_.isEqual(this._state, newState)) {
      this._state = newState;
      this.render();
    }

    return this;
  }

  selectTab(targ) {
    if (!this[`create${capitalize(targ)}TabView`]) {
      throw new Error(`${targ} is not a valid tab.`);
    }

    this._tab = targ;
    let tabView = this.tabViewCache[targ];

    if (!this.currentTabView || this.currentTabView !== tabView) {
      this.$('.js-tab').removeClass('clrT active');
      this.$(`.js-tab[data-tab="${targ}"]`).addClass('clrT active');

      if (this.currentTabView) this.currentTabView.$el.detach();

      if (!tabView) {
        tabView = this[`create${capitalize(targ)}TabView`]();
        this.tabViewCache[targ] = tabView;
        tabView.render();
      }

      this.$tabContent.append(tabView.$el);

      if (typeof tabView.onAttach === 'function') {
        tabView.onAttach.call(tabView);
      }

      this.currentTabView = tabView;
    }
  }

  createSummaryTabView() {
    const viewData = {
      model: this.model,
      vendor: {
        id: this.vendorId,
        getProfile: this.getVendorProfile.bind(this),
      },
      buyer: {
        id: this.buyerId,
        getProfile: this.getBuyerProfile.bind(this),
      },
    };

    if (this.moderatorId) {
      viewData.moderator = {
        id: this.moderatorId,
        getProfile: this.getModeratorProfile.bind(this),
      };
    }

    const view = this.createChild(Summary, viewData);
    this.listenTo(view, 'clickFulfillOrder',
      () => this.selectTab('fulfillOrder'));
    this.listenTo(view, 'clickResolveDispute',
      () => this.selectTab('resolveDispute'));

    return view;
  }

  createDiscussionTabView() {
    const amActiveTab = () => (this.activeTab === 'discussion');
    const viewData = {
      orderId: this.model.id,
      buyer: {
        id: this.buyerId,
        getProfile: this.getBuyerProfile.bind(this),
      },
      vendor: {
        id: this.vendorId,
        getProfile: this.getVendorProfile.bind(this),
      },
      model: this.model,
      amActiveTab: amActiveTab.bind(this),
    };

    if (this.moderatorId) {
      viewData.moderator = {
        id: this.moderatorId,
        getProfile: this.getModeratorProfile.bind(this),
      };
    }

    const view = this.createChild(Discussion, viewData);
    this.listenTo(view, 'convoMarkedAsRead', () => {
      this.model.set('unreadChatMessages', 0);
      this.trigger('convoMarkedAsRead');
    });

    return view;
  }

  createContractTabView() {
    const view = this.createChild(Contract, {
      model: this.model,
    });

    this.listenTo(view, 'clickBackToSummary', () => this.selectTab('summary'));
    return view;
  }

  // This should not be called on a Case.
  createFulfillOrderTabView() {
    const contract = this.model.get('contract');

    const model = new OrderFulfillment({ orderId: this.model.id },
      {
        contractType: contract.type,
        isLocalPickup: contract.isLocalPickup,
      });

    const view = this.createChild(FulfillOrder, {
      model,
      contractType: contract.type,
      isLocalPickup: contract.isLocalPickup,
    });

    this.listenTo(view, 'clickBackToSummary clickCancel', () => this.selectTab('summary'));

    return view;
  }

  createDisputeOrderTabView() {
    const contractType = this.model.get('contract').type;

    const model = new OrderDispute({ orderId: this.model.id });

    const view = this.createChild(DisputeOrder, {
      model,
      contractType,
      moderator: {
        id: this.moderatorId,
        getProfile: this.getModeratorProfile.bind(this),
      },
    });

    this.listenTo(view, 'clickBackToSummary clickCancel', () => this.selectTab('summary'));

    return view;
  }

  createResolveDisputeTabView() {
    let modelAttrs = { orderId: this.model.id };
    const isResolvingDispute = resolvingDispute(this.model.id);

    // If this order is in the process of the dispute being resolved, we'll
    // populate the model with the data that was posted to the server.
    if (isResolvingDispute) {
      modelAttrs = {
        ...modelAttrs,
        ...isResolvingDispute.data,
      };
    }

    const model = new ResolveDisputeMd(modelAttrs);
    const view = this.createChild(ResolveDispute, {
      model,
      vendor: {
        id: this.vendorId,
        getProfile: this.getVendorProfile.bind(this),
      },
      buyer: {
        id: this.buyerId,
        getProfile: this.getBuyerProfile.bind(this),
      },
    });

    this.listenTo(view, 'clickBackToSummary clickCancel', () => this.selectTab('summary'));

    return view;
  }

  setUnreadChatMessagesBadge() {
    this.$unreadChatMessagesBadge.text(this.getUnreadChatMessagesText());
  }

  getUnreadChatMessagesText() {
    let count = this.model.get('unreadChatMessages');
    count = count > 0 ? count : '';
    count = count > 99 ? '…' : count;
    return count;
  }

  /**
   * Returns whether different action bar buttons should be displayed or not
   * based upon the order state.
   */
  get actionBarButtonState() {
    const orderState = this.model.get('state');
    let showDisputeOrderButton = false;

    if (this.buyerId === app.profile.id) {
      showDisputeOrderButton = this.moderatorId &&
        ['AWAITING_FULFILLMENT', 'PENDING', 'FULFILLED'].indexOf(orderState) > -1;
    } else if (this.vendorId === app.profile.id) {
      showDisputeOrderButton = this.moderatorId &&
        ['AWAITING_FULFILLMENT', 'FULFILLED'].indexOf(orderState) > -1;
    }

    return {
      showDisputeOrderButton,
    };
  }

  get $unreadChatMessagesBadge() {
    return this._$unreadChatMessagesBadge ||
      (this._$unreadChatMessagesBadge = this.$('.js-unreadChatMessagesBadge'));
  }

  render() {
    loadTemplate('modals/orderDetail/orderDetail.html', t => {
      const state = this.getState();

      this.$el.html(t({
        ...state,
        ...this.model.toJSON(),
        returnText: this.options.returnText,
        type: this.type,
        getUnreadChatMessagesText: this.getUnreadChatMessagesText.bind(this),
      }));
      super.render();

      this.$tabContent = this.$('.js-tabContent');
      this._$unreadChatMessagesBadge = null;

      if (this.featuredProfile) this.featuredProfile.remove();
      this.featuredProfile = this.createChild(ProfileBox, {
        model: this.featuredProfileMd || null,
        initialState: {
          isFetching: this.featuredProfileFetch && this.featuredProfileFetch.state() === 'pending',
        },
      });
      this.$('.js-featuredProfile').html(this.featuredProfile.render().el);

      if (!state.isFetching && !state.fetchError) {
        this.selectTab(this.activeTab);

        if (this.actionBar) this.actionBar.remove();
        this.actionBar = this.createChild(ActionBar, {
          orderId: this.model.id,
          initialState: this.actionBarButtonState,
        });
        this.$('.js-actionBarContainer').html(this.actionBar.render().el);
        this.listenTo(this.actionBar, 'clickOpenDispute', () => this.selectTab('disputeOrder'));
      }
    });

    return this;
  }
}

export function checkValidParticipantObject(participant, type) {
  if (typeof participant !== 'object') {
    throw new Error(`Please provide a participant object for the ${type}.`);
  }

  if (typeof type !== 'string') {
    throw new Error('Please provide the participant type as a string.');
  }

  if (!participant.id || typeof participant.getProfile !== 'function') {
    throw new Error(`The ${type} object is not valid. It should have an id ` +
      'as well as a getProfile function that returns a promise that ' +
      'resolves with a profile model.');
  }
}
