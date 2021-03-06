import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { compose } from 'redux';
import { FormattedMessage, intlShape, injectIntl } from 'react-intl';
import pickBy from 'lodash/pickBy';
import classNames from 'classnames';
import config from '../../config';
import routeConfiguration from '../../routeConfiguration';
import { ensureCurrentUser } from '../../util/data';
import { withViewport } from '../../util/contextHelpers';
import { parse, stringify } from '../../util/urlHelpers';
import { createResourceLocatorString, pathByRouteName } from '../../util/routes';
import { propTypes } from '../../util/types';
import { isTooManyEmailVerificationRequestsError } from '../../util/errors';
import {
  Button,
  IconEmailAttention,
  InlineTextButton,
  Logo,
  Modal,
  NamedLink,
  TopbarDesktop,
  TopbarMobileMenu,
} from '../../components';
import { TopbarSearchForm } from '../../forms';

import MenuIcon from './MenuIcon';
import SearchIcon from './SearchIcon';
import css from './Topbar.css';

const MAX_MOBILE_SCREEN_WIDTH = 768;
const MISSING_INFORMATION_MODAL_WHITELIST = [
  'LoginPage',
  'SignupPage',
  'ContactDetailsPage',
  'EmailVerificationPage',
  'PasswordResetPage',
  'PayoutPreferencesPage',
];

const redirectToURLWithModalState = (props, modalStateParam) => {
  const { history, location } = props;
  const { pathname, search, state } = location;
  const searchString = `?${stringify({ [modalStateParam]: 'open', ...parse(search) })}`;
  history.push(`${pathname}${searchString}`, state);
};

const redirectToURLWithoutModalState = (props, modalStateParam) => {
  const { history, location } = props;
  const { pathname, search, state } = location;
  const queryParams = pickBy(parse(search), (v, k) => {
    return k !== modalStateParam;
  });
  const stringified = stringify(queryParams);
  const searchString = stringified ? `?${stringified}` : '';
  history.push(`${pathname}${searchString}`, state);
};

const GenericError = props => {
  const { show } = props;
  const classes = classNames(css.genericError, {
    [css.genericErrorVisible]: show,
  });
  return (
    <div className={classes}>
      <div className={css.genericErrorContent}>
        <p className={css.genericErrorText}>
          <FormattedMessage id="Topbar.genericError" />
        </p>
      </div>
    </div>
  );
};

const { bool } = PropTypes;

GenericError.propTypes = {
  show: bool.isRequired,
};

const ReminderModalContent = props => {
  const {
    currentUser,
    email,
    resendErrorMessage,
    sendVerificationEmailInProgress,
    resendEmailLink,
    fixEmailLink,
  } = props;
  const emailVerificationMissingContent = (
    <div>
      <IconEmailAttention className={css.modalIcon} />
      <p className={css.modalTitle}>
        <FormattedMessage id="Topbar.verifyEmailTitle" />
      </p>
      <p className={css.modalMessage}>
        <FormattedMessage id="Topbar.verifyEmailText" />
      </p>
      <p className={css.modalMessage}>
        <FormattedMessage id="Topbar.checkInbox" values={{ email }} />
      </p>
      {resendErrorMessage}

      <div className={css.bottomWrapper}>
        <p className={css.helperText}>
          {sendVerificationEmailInProgress ? (
            <FormattedMessage id="Topbar.sendingEmail" />
          ) : (
            <FormattedMessage id="Topbar.resendEmail" values={{ resendEmailLink }} />
          )}
        </p>
        <p className={css.helperText}>
          <FormattedMessage id="Topbar.fixEmail" values={{ fixEmailLink }} />
        </p>
      </div>
    </div>
  );

  const stripeAccountMissingContent = (
    <div>
      <p className={css.modalTitle}>
        <FormattedMessage id="Topbar.missingStripeAccountTitle" />
      </p>
      <p className={css.modalMessage}>
        <FormattedMessage id="Topbar.missingStripeAccountText" />
      </p>
      <div className={css.bottomWrapper}>
        <NamedLink className={css.reminderModalLinkButton} name="PayoutPreferencesPage">
          <FormattedMessage id="Topbar.gotoPaymentSettings" />
        </NamedLink>
      </div>
    </div>
  );

  const currentUserLoaded = currentUser && currentUser.id;
  let content = null;

  if (currentUserLoaded && !currentUser.attributes.emailVerified) {
    content = emailVerificationMissingContent;
  } else if (currentUserLoaded && !currentUser.attributes.stripeConnected) {
    content = stripeAccountMissingContent;
  }

  return content;
};

class TopbarComponent extends Component {
  constructor(props) {
    super(props);
    this.state = {
      showMissingInformationReminder: false,
      hasSeenMissingInformationReminder: false,
    };

    this.onHistoryChanged = this.handleMissingInformationReminder.bind(this);
    this.handleMobileMenuOpen = this.handleMobileMenuOpen.bind(this);
    this.handleMobileMenuClose = this.handleMobileMenuClose.bind(this);
    this.handleMobileSearchOpen = this.handleMobileSearchOpen.bind(this);
    this.handleMobileSearchClose = this.handleMobileSearchClose.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
    this.handleLogout = this.handleLogout.bind(this);
  }

  componentWillReceiveProps(nextProps) {
    const { currentUser, currentUserHasListings, currentUserHasOrders, location } = nextProps;
    const user = ensureCurrentUser(currentUser);
    this.handleMissingInformationReminder(
      user,
      currentUserHasListings,
      currentUserHasOrders,
      location
    );
  }

  handleMissingInformationReminder(
    currentUser,
    currentUserHasListings,
    currentUserHasOrders,
    newLocation
  ) {
    // Track if path changes inside Page level component
    const pathChanged = newLocation.pathname !== this.props.location.pathname;
    const emailUnverified = !!currentUser.id && !currentUser.attributes.emailVerified;
    const stripeAccountMissing = !!currentUser.id && !currentUser.attributes.stripeConnected;
    const infoMissing = emailUnverified || (currentUserHasListings && stripeAccountMissing);
    const notRemindedYet =
      !this.state.showMissingInformationReminder && !this.state.hasSeenMissingInformationReminder;
    const showOnPathChange = notRemindedYet || pathChanged;

    // Emails are sent when order is initiated
    // Customer is likely to get email soon when she books something
    // Provider email should work - she should get an email when someone books a listing
    const hasOrders = currentUserHasOrders === true;
    const hasListingsOrOrders = currentUserHasListings || hasOrders;

    const routes = routeConfiguration();
    const whitelistedPaths = MISSING_INFORMATION_MODAL_WHITELIST.map(page =>
      pathByRouteName(page, routes)
    );
    const isNotWhitelisted = !whitelistedPaths.includes(newLocation.pathname);

    const showReminder = infoMissing && isNotWhitelisted && hasListingsOrOrders && showOnPathChange;

    // Show reminder
    if (showReminder) {
      this.setState({ showMissingInformationReminder: true });
    }
  }

  handleMobileMenuOpen() {
    redirectToURLWithModalState(this.props, 'mobilemenu');
  }

  handleMobileMenuClose() {
    redirectToURLWithoutModalState(this.props, 'mobilemenu');
  }

  handleMobileSearchOpen() {
    redirectToURLWithModalState(this.props, 'mobilesearch');
  }

  handleMobileSearchClose() {
    redirectToURLWithoutModalState(this.props, 'mobilesearch');
  }

  handleSubmit(values) {
    const { currentSearchParams } = this.props;
    const { search, selectedPlace } = values.location;
    const { history } = this.props;
    const { origin, bounds, country } = selectedPlace;
    const originMaybe = config.sortSearchByDistance ? { origin } : {};
    const searchParams = {
      ...currentSearchParams,
      ...originMaybe,
      address: search,
      bounds,
      country,
    };
    history.push(createResourceLocatorString('SearchPage', routeConfiguration(), {}, searchParams));
  }

  handleLogout() {
    const { onLogout, history } = this.props;
    onLogout().then(() => {
      const path = pathByRouteName('LandingPage', routeConfiguration());

      // In production we ensure that data is really lost,
      // but in development mode we use stored values for debugging
      if (config.dev) {
        history.push(path);
      } else if (typeof window !== 'undefined') {
        window.location = path;
      }

      console.log('logged out'); // eslint-disable-line
    });
  }

  render() {
    const {
      className,
      rootClassName,
      desktopClassName,
      mobileRootClassName,
      mobileClassName,
      isAuthenticated,
      authInProgress,
      currentUser,
      currentUserHasListings,
      currentPage,
      notificationCount,
      viewport,
      intl,
      location,
      onManageDisableScrolling,
      onResendVerificationEmail,
      sendVerificationEmailInProgress,
      sendVerificationEmailError,
      showGenericError,
    } = this.props;

    const { mobilemenu, mobilesearch, address, origin, bounds, country } = parse(location.search, {
      latlng: ['origin'],
      latlngBounds: ['bounds'],
    });

    const notificationDot = notificationCount > 0 ? <div className={css.notificationDot} /> : null;

    const isMobileLayout = viewport.width < MAX_MOBILE_SCREEN_WIDTH;
    const isMobileMenuOpen = isMobileLayout && mobilemenu === 'open';
    const isMobileSearchOpen = isMobileLayout && mobilesearch === 'open';

    const mobileMenu = (
      <TopbarMobileMenu
        isAuthenticated={isAuthenticated}
        currentUserHasListings={currentUserHasListings}
        currentUser={currentUser}
        onLogout={this.handleLogout}
        notificationCount={notificationCount}
        currentPage={currentPage}
      />
    );

    // Only render current search if full place object is available in the URL params
    const locationFieldsPresent = address && origin && bounds && country;
    const initialSearchFormValues = {
      location: locationFieldsPresent
        ? {
            search: address,
            selectedPlace: { address, origin, bounds, country },
          }
        : null,
    };

    const user = ensureCurrentUser(currentUser);
    const email = user.id ? <span className={css.email}>{user.attributes.email}</span> : '';

    const resendEmailLink = (
      <InlineTextButton className={css.helperLink} onClick={onResendVerificationEmail}>
        <FormattedMessage id="Topbar.resendEmailLinkText" />
      </InlineTextButton>
    );
    const fixEmailLink = (
      <NamedLink className={css.helperLink} name="ContactDetailsPage">
        <FormattedMessage id="Topbar.fixEmailLinkText" />
      </NamedLink>
    );

    const resendErrorTranslationId = isTooManyEmailVerificationRequestsError(
      sendVerificationEmailError
    )
      ? 'Topbar.resendFailedTooManyRequests'
      : 'Topbar.resendFailed';
    const resendErrorMessage = sendVerificationEmailError ? (
      <p className={css.error}>
        <FormattedMessage id={resendErrorTranslationId} />
      </p>
    ) : null;
    const closeButtonMessage = <FormattedMessage id="Topbar.closeVerifyEmailReminder" />;

    const classes = classNames(rootClassName || css.root, className);

    return (
      <div className={classes}>
        <div className={classNames(mobileRootClassName || css.container, mobileClassName)}>
          <Button
            rootClassName={css.menu}
            onClick={this.handleMobileMenuOpen}
            title={intl.formatMessage({ id: 'Topbar.menuIcon' })}
          >
            <MenuIcon className={css.menuIcon} />
            {notificationDot}
          </Button>
          <NamedLink
            className={css.home}
            name="LandingPage"
            title={intl.formatMessage({ id: 'Topbar.logoIcon' })}
          >
            <Logo format="mobile" />
          </NamedLink>
          <Button
            rootClassName={css.searchMenu}
            onClick={this.handleMobileSearchOpen}
            title={intl.formatMessage({ id: 'Topbar.searchIcon' })}
          >
            <SearchIcon className={css.searchMenuIcon} />
          </Button>
        </div>
        <div className={css.desktop}>
          <TopbarDesktop
            className={desktopClassName}
            currentUserHasListings={currentUserHasListings}
            currentUser={currentUser}
            currentPage={currentPage}
            initialSearchFormValues={initialSearchFormValues}
            intl={intl}
            isAuthenticated={isAuthenticated}
            notificationCount={notificationCount}
            onLogout={this.handleLogout}
            onSearchSubmit={this.handleSubmit}
          />
        </div>
        <Modal
          id="TopbarMobileMenu"
          isOpen={isMobileMenuOpen}
          onClose={this.handleMobileMenuClose}
          onManageDisableScrolling={onManageDisableScrolling}
        >
          {authInProgress ? null : mobileMenu}
        </Modal>
        <Modal
          id="TopbarMobileSearch"
          containerClassName={css.modalContainer}
          isOpen={isMobileSearchOpen}
          onClose={this.handleMobileSearchClose}
          onManageDisableScrolling={onManageDisableScrolling}
        >
          <div className={css.searchContainer}>
            <TopbarSearchForm
              form="TopbarSearchForm"
              onSubmit={this.handleSubmit}
              initialValues={initialSearchFormValues}
              isMobile
            />
            <p className={css.mobileHelp}>
              <FormattedMessage id="Topbar.mobileSearchHelp" />
            </p>
          </div>
        </Modal>

        <Modal
          id="MissingInformationReminder"
          containerClassName={css.missingInformationModal}
          isOpen={this.state.showMissingInformationReminder}
          onClose={() => {
            this.setState({
              showMissingInformationReminder: false,
              hasSeenMissingInformationReminder: true,
            });
          }}
          onManageDisableScrolling={onManageDisableScrolling}
          closeButtonMessage={closeButtonMessage}
        >
          <ReminderModalContent
            currentUser={currentUser}
            email={email}
            resendErrorMessage={resendErrorMessage}
            sendVerificationEmailInProgress={sendVerificationEmailInProgress}
            resendEmailLink={resendEmailLink}
            fixEmailLink={fixEmailLink}
          />
        </Modal>
        <GenericError show={showGenericError} />
      </div>
    );
  }
}

TopbarComponent.defaultProps = {
  className: null,
  rootClassName: null,
  desktopClassName: null,
  mobileRootClassName: null,
  mobileClassName: null,
  notificationCount: 0,
  currentUser: null,
  currentUserHasOrders: null,
  currentPage: null,
  sendVerificationEmailError: null,
};

const { func, number, shape, string } = PropTypes;

TopbarComponent.propTypes = {
  className: string,
  rootClassName: string,
  desktopClassName: string,
  mobileRootClassName: string,
  mobileClassName: string,
  isAuthenticated: bool.isRequired,
  authInProgress: bool.isRequired,
  currentUser: propTypes.currentUser,
  currentUserHasListings: bool.isRequired,
  currentUserHasOrders: bool,
  currentPage: string,
  notificationCount: number,
  onLogout: func.isRequired,
  onManageDisableScrolling: func.isRequired,
  onResendVerificationEmail: func.isRequired,
  sendVerificationEmailInProgress: bool.isRequired,
  sendVerificationEmailError: propTypes.error,
  showGenericError: bool.isRequired,

  // These are passed from Page to keep Topbar rendering aware of location changes
  history: shape({
    push: func.isRequired,
  }).isRequired,
  location: shape({
    search: string.isRequired,
  }).isRequired,

  // from withViewport
  viewport: shape({
    width: number.isRequired,
    height: number.isRequired,
  }).isRequired,

  // from injectIntl
  intl: intlShape.isRequired,
};

const Topbar = compose(withViewport, injectIntl)(TopbarComponent);

Topbar.displayName = 'Topbar';

export default Topbar;
